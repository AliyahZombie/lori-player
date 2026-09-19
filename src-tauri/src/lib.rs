use base64::{engine::general_purpose::STANDARD, Engine};
use lofty::{
    file::{AudioFile, TaggedFileExt},
    probe::Probe,
    tag::Accessor,
};
use serde::Serialize;
use std::{collections::HashSet, path::Path};
use tauri::Manager;

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
                std::process::Command::new("ffprobe")
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
    let output = std::process::Command::new("ffmpeg")
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
        .map_err(|e| format!("无法启动本地音频解码器，请安装 FFmpeg：{e}"))?;
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
        width >= 120 && height >= 50
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

#[tauri::command]
async fn open_lyrics(app: tauri::AppHandle, editable: Option<bool>) -> Result<(), String> {
    let ignore_cursor = !editable.unwrap_or(false);
    if let Some(window) = app.get_webview_window("lyrics") {
        window
            .set_ignore_cursor_events(ignore_cursor)
            .map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
        return window.show().map_err(|e| e.to_string());
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
    .inner_size(760.0, 100.0)
    .min_inner_size(360.0, 90.0)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .build()
    .map_err(|e| e.to_string())?;
    remember_lyrics_position(&app, &window)?;
    window
        .set_ignore_cursor_events(ignore_cursor)
        .map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())
}
#[tauri::command]
fn close_lyrics(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("lyrics") {
        window.close().map_err(|e| e.to_string())?;
    }
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
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let (Some(window), Some(icon)) =
                (app.get_webview_window("main"), app.default_window_icon())
            {
                window.set_icon(icon.clone())?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            import_paths,
            load_audio,
            open_lyrics,
            close_lyrics,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("Failed to run Lori Player");
}

#[cfg(test)]
mod tests {
    use super::*;
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
