use base64::{engine::general_purpose::STANDARD, Engine};
use lofty::{
    file::{AudioFile, TaggedFileExt},
    probe::Probe,
    tag::Accessor,
};
use serde::Serialize;
use std::{
    collections::HashSet,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

// Windows ships a private decoder; never depend on the user's PATH or cwd.
// Tauri places bundled resources next to the executable on Windows.
fn audio_command(name: &str) -> std::process::Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let directory = if cfg!(debug_assertions) {
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/ffmpeg/bin")
        } else {
            std::env::current_exe()
                .expect("executable path")
                .parent()
                .expect("executable directory")
                .join("ffmpeg/bin")
        };
        let mut command = std::process::Command::new(directory.join(format!("{name}.exe")));
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        command
    }
    #[cfg(not(target_os = "windows"))]
    std::process::Command::new(name)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Track {
    id: String,
    path: String,
    title: String,
    artist: String,
    album: String,
    duration: f64,
    cover: Option<String>,
    lyrics: String,
    format: String,
    folder: String,
}
#[derive(Serialize)]
struct ImportResult {
    tracks: Vec<Track>,
    errors: Vec<String>,
}

#[tauri::command]
async fn import_paths(app: tauri::AppHandle, paths: Vec<String>) -> Result<ImportResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut tracks = Vec::new();
        let mut errors = Vec::new();
        let mut seen = HashSet::new();
        for input in paths {
            for entry in walkdir::WalkDir::new(input).follow_links(false).into_iter() {
                let entry = match entry {
                    Ok(e) => e,
                    Err(e) => {
                        errors.push(e.to_string());
                        continue;
                    }
                };
                let p = entry.path();
                if !p.is_file() {
                    continue;
                }
                let ext = p
                    .extension()
                    .and_then(|x| x.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if !["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus", "aiff"]
                    .contains(&ext.as_str())
                {
                    continue;
                }
                let path = match p.canonicalize() {
                    Ok(p) => p,
                    Err(e) => {
                        errors.push(e.to_string());
                        continue;
                    }
                };
                if !seen.insert(path.clone()) {
                    continue;
                }
                match read_track(&path, &ext) {
                    Ok(track) => match app.asset_protocol_scope().allow_file(&path) {
                        Ok(_) => tracks.push(track),
                        Err(e) => errors.push(e.to_string()),
                    },
                    Err(e) => errors.push(format!("{}: {}", path.display(), e)),
                }
            }
        }
        ImportResult { tracks, errors }
    })
    .await
    .map_err(|e| e.to_string())
}
fn read_track(p: &Path, ext: &str) -> Result<Track, String> {
    let file = Probe::open(p)
        .map_err(|e| e.to_string())?
        .read()
        .map_err(|e| e.to_string())?;
    let tag = file.primary_tag().or_else(|| file.first_tag());
    let title = tag
        .and_then(|t| t.title())
        .map(|v| v.to_string())
        .unwrap_or_else(|| {
            p.file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned()
        });
    let artist = tag
        .and_then(|t| t.artist())
        .map(|v| v.to_string())
        .unwrap_or_else(|| "未知艺术家".into());
    let album = tag
        .and_then(|t| t.album())
        .map(|v| v.to_string())
        .unwrap_or_else(|| "未命名专辑".into());
    let cover = tag.and_then(|t| t.pictures().first()).map(|pic| {
        format!(
            "data:{};base64,{}",
            pic.mime_type().map(|m| m.as_str()).unwrap_or("image/jpeg"),
            STANDARD.encode(pic.data())
        )
    });
    let lyrics = std::fs::read_to_string(p.with_extension("lrc"))
        .or_else(|_| std::fs::read_to_string(p.with_extension("LRC")))
        .unwrap_or_else(|_| {
            tag.and_then(|t| t.get_string(&lofty::tag::ItemKey::Lyrics))
                .unwrap_or("")
                .to_string()
        });
    let path = p.to_string_lossy().into_owned();
    Ok(Track {
        id: path.clone(),
        path,
        title,
        artist,
        album,
        duration: {
            let duration = file.properties().duration().as_secs_f64();
            if duration > 0.0 {
                duration
            } else {
                // Some fragmented M4A files have a zero mvhd duration.
                audio_command("ffprobe")
                    .args([
                        "-v",
                        "error",
                        "-show_entries",
                        "format=duration",
                        "-of",
                        "default=noprint_wrappers=1:nokey=1",
                    ])
                    .arg(p)
                    .output()
                    .ok()
                    .filter(|o| o.status.success())
                    .and_then(|o| String::from_utf8(o.stdout).ok())
                    .and_then(|v| v.trim().parse::<f64>().ok())
                    .filter(|v| v.is_finite() && *v > 0.0)
                    .unwrap_or(0.0)
            }
        },
        cover,
        lyrics,
        format: ext.to_uppercase(),
        folder: p
            .parent()
            .and_then(|d| d.file_name())
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
    })
}
// Use local PCM playback to avoid WebKitGTK's AAC/fragmented-MP4 decoder
// differences. The original file is read only; the disposable cache is bounded.
fn decoded_audio(app: &tauri::AppHandle, path: &Path) -> Result<Vec<u8>, String> {
    use std::hash::{Hash, Hasher};
    let metadata = path.metadata().map_err(|e| e.to_string())?;
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut hash);
    metadata.len().hash(&mut hash);
    metadata.modified().ok().hash(&mut hash);
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("decoded-audio-v1");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let cached = directory.join(format!("{:x}.wav", hash.finish()));
    if cached.exists() {
        return std::fs::read(cached).map_err(|e| e.to_string());
    }
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = directory.join(format!("{}-{nonce}.tmp.wav", std::process::id()));
    let output = audio_command("ffmpeg")
        .args(["-nostdin", "-v", "error", "-y", "-i"])
        .arg(path)
        .args([
            "-map",
            "0:a:0",
            "-vn",
            "-ac",
            "2",
            "-ar",
            "44100",
            "-c:a",
            "pcm_s16le",
            "-f",
            "wav",
        ])
        .arg(&temporary)
        .output()
        .map_err(|e| {
            if cfg!(target_os = "windows") {
                format!("无法启动内置音频解码器，请重新安装 Lori Player：{e}")
            } else {
                format!("无法启动本地音频解码器，请安装 FFmpeg：{e}")
            }
        })?;
    if !output.status.success() {
        let _ = std::fs::remove_file(&temporary);
        return Err(format!(
            "音频解码失败：{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    std::fs::rename(&temporary, &cached).map_err(|e| e.to_string())?;
    let bytes = std::fs::read(&cached).map_err(|e| e.to_string())?;
    // Only remove this app's generated cache, oldest entries first.
    let mut entries: Vec<_> = std::fs::read_dir(&directory)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().is_some_and(|x| x == "wav"))
        .filter_map(|e| {
            e.metadata()
                .ok()
                .map(|m| (e.path(), m.len(), m.modified().ok()))
        })
        .collect();
    let mut total: u64 = entries.iter().map(|e| e.1).sum();
    entries.sort_by_key(|e| e.2);
    for (path, size, _) in entries {
        if total <= 512 * 1024 * 1024 {
            break;
        }
        if std::fs::remove_file(path).is_ok() {
            total = total.saturating_sub(size);
        }
    }
    Ok(bytes)
}
#[tauri::command]
async fn load_audio(app: tauri::AppHandle, path: String) -> Result<tauri::ipc::Response, String> {
    let path = std::path::PathBuf::from(path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !app.asset_protocol_scope().is_allowed(&path) {
        return Err("请先将这首歌曲导入曲库".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        decoded_audio(&app, &path).map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|e| e.to_string())?
}

// Hash the original file, never the decoded playback cache. Bounded memory and
// a blocking worker keep disk reads away from the window/event thread.
#[tauri::command]
async fn fingerprint_audio(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let path = std::path::PathBuf::from(path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !app.asset_protocol_scope().is_allowed(&path) {
        return Err("请先将这首歌曲导入曲库".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Read;
        let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
        let mut context = md5::Context::new();
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
            if count == 0 {
                break;
            }
            context.consume(&buffer[..count]);
        }
        Ok(format!("{:x}", context.compute()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn save_ledger_export(path: String, contents: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Write beside the destination, then rename: failed writes leave the old export intact.
        let destination = std::path::PathBuf::from(path);
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos();
        let temporary = destination.with_extension(format!("{nonce}.tmp"));
        let result = (|| {
            use std::io::Write;
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|e| e.to_string())?;
            file.write_all(contents.as_bytes())
                .map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
            std::fs::rename(&temporary, &destination).map_err(|e| e.to_string())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(temporary);
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

fn parse_lyrics_position(value: &str) -> Option<(i32, i32)> {
    let mut parts = value.split_whitespace();
    let position = (parts.next()?.parse().ok()?, parts.next()?.parse().ok()?);
    if parts.next().is_some() {
        return None;
    }
    Some(position)
}

fn position_is_visible(
    position: (i32, i32),
    size: (u32, u32),
    monitors: &[(i32, i32, u32, u32)],
) -> bool {
    let (x, y) = (i64::from(position.0), i64::from(position.1));
    monitors.iter().any(|&(mx, my, mw, mh)| {
        let (mx, my) = (i64::from(mx), i64::from(my));
        let width = (x + i64::from(size.0)).min(mx + i64::from(mw)) - x.max(mx);
        let height = (y + i64::from(size.1)).min(my + i64::from(mh)) - y.max(my);
        width >= 120 && height >= 30
    })
}

fn remember_lyrics_position(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
) -> Result<(), String> {
    let directory = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let path = directory.join("lyrics-position.txt");
    if let Some(position) = std::fs::read_to_string(&path)
        .ok()
        .and_then(|value| parse_lyrics_position(&value))
    {
        let monitors = window.available_monitors().map_err(|e| e.to_string())?;
        let bounds: Vec<_> = monitors
            .iter()
            .map(|m| {
                (
                    m.position().x,
                    m.position().y,
                    m.size().width,
                    m.size().height,
                )
            })
            .collect();
        let size = window.outer_size().map_err(|e| e.to_string())?;
        if position_is_visible(position, (size.width, size.height), &bounds) {
            window
                .set_position(tauri::PhysicalPosition::new(position.0, position.1))
                .map_err(|e| e.to_string())?;
        }
    }
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Moved(position) = event {
            let temporary = path.with_extension("tmp");
            if std::fs::write(&temporary, format!("{} {}", position.x, position.y)).is_ok() {
                if let Err(error) = std::fs::rename(&temporary, &path) {
                    eprintln!("Could not save desktop lyric position: {error}");
                }
            }
        }
    });
    Ok(())
}

fn lyrics_height(font_size: f64) -> f64 {
    (font_size.clamp(18.0, 56.0) * 1.5 + 6.0).ceil().max(36.0)
}

#[tauri::command]
fn resize_lyrics(app: tauri::AppHandle, font_size: f64) -> Result<(), String> {
    if !font_size.is_finite() {
        return Err("Invalid font size".into());
    }
    if let Some(window) = app.get_webview_window("lyrics") {
        let width = window
            .inner_size()
            .map_err(|e| e.to_string())?
            .to_logical::<f64>(window.scale_factor().map_err(|e| e.to_string())?)
            .width;
        window
            .set_size(tauri::LogicalSize::new(width, lyrics_height(font_size)))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn open_lyrics(
    app: tauri::AppHandle,
    editable: Option<bool>,
    font_size: Option<f64>,
    show: Option<bool>,
) -> Result<(), String> {
    let ignore_cursor = !editable.unwrap_or(false);
    // No lyric line to read yet: build and place the overlay, but leave it
    // hidden. The lyric window shows itself as soon as a lyric arrives.
    let visible = show.unwrap_or(true);
    let height = lyrics_height(font_size.filter(|s| s.is_finite()).unwrap_or(34.0));
    if let Some(window) = app.get_webview_window("lyrics") {
        window
            .set_ignore_cursor_events(ignore_cursor)
            .map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
        return if visible {
            window.show().map_err(|e| e.to_string())
        } else {
            window.hide().map_err(|e| e.to_string())
        };
    }
    let window = tauri::WebviewWindowBuilder::new(
        &app,
        "lyrics",
        tauri::WebviewUrl::App("index.html?lyrics=1".into()),
    )
    .title("Lori · 桌面歌词")
    .background_color(tauri::window::Color(0, 0, 0, 0))
    .shadow(false)
    .visible_on_all_workspaces(true)
    .focused(false)
    .focusable(false)
    .inner_size(760.0, height)
    .min_inner_size(360.0, 36.0)
    .max_inner_size(2400.0, 90.0)
    .visible(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .build()
    .map_err(|e| e.to_string())?;
    // Configure the X11 window before mapping: a dock overlay has no titlebar
    // and is not constrained by GNOME's normal-window work-area placement.
    let (ready_tx, ready_rx) = std::sync::mpsc::channel();
    let overlay = window.clone();
    app.run_on_main_thread(move || {
        #[cfg(target_os = "linux")]
        {
            use gtk::prelude::*;
            if let Ok(gtk_window) = overlay.gtk_window() {
                gtk_window.set_type_hint(gtk::gdk::WindowTypeHint::Dock);
                gtk_window.set_decorated(false);
                gtk_window.set_accept_focus(false);
                gtk_window.show_all();
            }
        }
        let result = overlay.show().map_err(|e| e.to_string());
        let _ = ready_tx.send(result);
    })
    .map_err(|e| e.to_string())?;
    ready_rx.recv().map_err(|e| e.to_string())??;
    remember_lyrics_position(&app, &window)?;
    window
        .set_ignore_cursor_events(ignore_cursor)
        .map_err(|e| e.to_string())?;
    // The overlay is mapped once so the dock type hint and the remembered
    // position land on a real window, then hidden again when there is no
    // lyric yet; the webview keeps running and shows itself later.
    if visible {
        window.show().map_err(|e| e.to_string())
    } else {
        window.hide().map_err(|e| e.to_string())
    }
}
#[tauri::command]
fn focus_main(app: tauri::AppHandle) -> Result<(), String> {
    show_main(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn close_lyrics(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("lyrics") {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Driven by the player whenever the current song gains or loses its lyrics, so
// the overlay never keeps a placeholder line sitting on the desktop. A missing
// window is the normal case while desktop lyrics are switched off.
#[tauri::command]
fn set_lyrics_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("lyrics") {
        return if visible {
            window.show().map_err(|e| e.to_string())
        } else {
            window.hide().map_err(|e| e.to_string())
        };
    }
    Ok(())
}
// Hiding keeps the WebView (and its audio/recording state) alive.
#[tauri::command]
fn hide_main(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn show_main(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.show()?;
        window.unminimize()?;
        window.set_focusable(true)?;
        window.set_focus()?;
    }
    Ok(())
}

#[derive(Default)]
struct PlayerLifecycle {
    ready: AtomicBool,
    quit_requested: AtomicBool,
}

// A tray click can arrive before the WebView installs its listeners. Queue it
// until the player can flush its ledger instead of silently dropping the exit.
fn request_quit(app: &tauri::AppHandle) -> tauri::Result<()> {
    let lifecycle = app.state::<PlayerLifecycle>();
    lifecycle.quit_requested.store(true, Ordering::SeqCst);
    if lifecycle.ready.load(Ordering::SeqCst) {
        app.emit_to("main", "lori-quit-requested", ())?;
    }
    Ok(())
}

#[tauri::command]
fn player_ready(app: tauri::AppHandle) -> Result<(), String> {
    let lifecycle = app.state::<PlayerLifecycle>();
    lifecycle.ready.store(true, Ordering::SeqCst);
    if lifecycle.quit_requested.load(Ordering::SeqCst) {
        app.emit_to("main", "lori-quit-requested", ())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn create_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show-player", "显示播放器", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit-player", "退出播放器", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &separator, &quit])?;
    let mut tray = TrayIconBuilder::with_id("lori-player")
        .tooltip("Lori Player")
        .menu(&menu)
        // Linux always exposes the menu; Windows/macOS can restore on left click.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show-player" => {
                if let Err(error) = show_main(app) {
                    eprintln!("Could not show Lori: {error}");
                }
            }
            "quit-player" => {
                // The player pauses and commits its last ledger checkpoint before
                // acknowledging this request through quit_app.
                if let Err(error) = request_quit(app) {
                    eprintln!("Could not request Lori exit: {error}");
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                if let Err(error) = show_main(tray.app_handle()) {
                    eprintln!("Could not show Lori: {error}");
                }
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

pub fn run() {
    // GNOME Wayland does not implement keep-above for ordinary xdg-toplevels.
    // Choose XWayland before GTK creates any threads/windows when available.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WAYLAND_DISPLAY").is_some()
        && std::env::var_os("DISPLAY").is_some()
        && std::env::var_os("GDK_BACKEND").is_none()
    {
        std::env::set_var("GDK_BACKEND", "x11");
    }
    tauri::Builder::default()
        .manage(PlayerLifecycle::default())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Err(error) = show_main(app) {
                eprintln!("Could not restore Lori: {error}");
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if let Err(error) = window.hide() {
                        eprintln!("Could not hide Lori: {error}");
                    }
                }
            }
        })
        .setup(|app| {
            create_tray(app.handle())?;
            if let (Some(window), Some(icon)) =
                (app.get_webview_window("main"), app.default_window_icon())
            {
                window.set_icon(icon.clone())?;
                window.set_focusable(true)?;
                #[cfg(target_os = "linux")]
                {
                    use gtk::prelude::*;
                    let gtk_window = window.gtk_window()?;
                    gtk_window.set_type_hint(gtk::gdk::WindowTypeHint::Normal);
                    gtk_window.set_accept_focus(true);
                    gtk_window.set_focus_on_map(true);
                }
                window.set_focus()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            import_paths,
            load_audio,
            fingerprint_audio,
            save_ledger_export,
            open_lyrics,
            close_lyrics,
            set_lyrics_visible,
            focus_main,
            resize_lyrics,
            hide_main,
            player_ready,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("Failed to run Lori Player");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "windows")]
    #[test]
    fn bundled_decoder_handles_unicode_paths_and_original_fingerprints() {
        let directory = std::env::temp_dir().join(format!("Lori 音频 test {}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let source = directory.join("月光 sample.flac");
        let decoded = directory.join("decoded.wav");
        let generated = audio_command("ffmpeg")
            .args([
                "-nostdin",
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=1",
            ])
            .arg(&source)
            .output()
            .unwrap();
        assert!(
            generated.status.success(),
            "{}",
            String::from_utf8_lossy(&generated.stderr)
        );
        let original = md5::compute(std::fs::read(&source).unwrap());
        // canonicalize produces a Windows extended-length path (\\?\ prefix).
        let canonical = source.canonicalize().unwrap();
        let track = read_track(&canonical, "flac").unwrap();
        assert!(track.duration > 0.9);
        let probe = audio_command("ffprobe")
            .args([
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
            ])
            .arg(&canonical)
            .output()
            .unwrap();
        assert!(
            probe.status.success(),
            "{}",
            String::from_utf8_lossy(&probe.stderr)
        );
        let output = audio_command("ffmpeg")
            .args(["-nostdin", "-v", "error", "-y", "-i"])
            .arg(&canonical)
            .args([
                "-map",
                "0:a:0",
                "-vn",
                "-ac",
                "2",
                "-ar",
                "44100",
                "-c:a",
                "pcm_s16le",
                "-f",
                "wav",
            ])
            .arg(&decoded)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(std::fs::metadata(decoded).unwrap().len() > 176_400);
        assert_eq!(original, md5::compute(std::fs::read(source).unwrap()));
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn restores_valid_positions_including_negative_monitor_coordinates() {
        assert_eq!(parse_lyrics_position("-1200 300"), Some((-1200, 300)));
        assert_eq!(parse_lyrics_position("garbled"), None);
        assert_eq!(parse_lyrics_position("12 30 extra"), None);
        assert_eq!(parse_lyrics_position("999999999999 1"), None);
        let monitors = [(-1920, 0, 1920, 1080), (0, 0, 1920, 1080)];
        assert!(position_is_visible((-1200, 300), (760, 100), &monitors));
        assert!(position_is_visible((600, 900), (760, 100), &monitors));
        assert!(!position_is_visible((5000, 300), (760, 100), &monitors));
        assert!(!position_is_visible((1900, 1070), (760, 100), &monitors));
    }

    #[test]
    #[ignore = "Set LORI_TEST_MUSIC_DIR to a directory of real audio samples"]
    fn reads_real_local_samples() {
        let directory = std::env::var("LORI_TEST_MUSIC_DIR").expect("sample directory");
        let mut count = 0;
        let mut covers = 0;
        let mut lyrics = 0;
        for entry in std::fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|v| v.to_str()) != Some("m4a") {
                continue;
            }
            let track = read_track(&path, "m4a").unwrap();
            assert!(track.duration > 0.0, "{}", path.display());
            assert!(!track.title.is_empty());
            if track.cover.is_some() {
                covers += 1;
            }
            if !track.lyrics.is_empty() {
                lyrics += 1;
            }
            count += 1;
        }
        assert!(count > 0);
        println!("Read {count} local samples: {covers} embedded covers, {lyrics} lyrics");
    }
}
