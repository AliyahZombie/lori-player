# Lori Player

**A quiet home for your local music.**

A compact desktop music player built with Tauri 2 and React: cover art or synced lyrics on the left, your playlist on the right. Everything stays on your machine — no account, no network requests, and your audio files are never moved, renamed, or rewritten.

[English](README.md) · [简体中文](README.zh-CN.md)

![license: MIT](https://img.shields.io/badge/license-MIT-blue)
![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB)
![React 19](https://img.shields.io/badge/React-19-61DAFB)
![platform: Linux](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey)

<p align="center">
  <img src="docs/screenshots/player-cover.png" width="400" alt="Lori Player showing cover art, transport controls and the playlist">
  <img src="docs/screenshots/player-lyrics.png" width="400" alt="Lori Player showing synced lyrics next to the playlist">
</p>
<p align="center">
  <img src="docs/screenshots/lyrics-overlay.png" width="400" alt="Always-on-top desktop lyrics overlay, shown over a dark backdrop">
</p>

## Features

- **Your files stay yours.** Import with the `+` button or a folder button (recursive scan). Nothing is moved, copied, or retagged; removing a track from the library deletes nothing from disk.
- **Metadata that is already there.** Title, artist, and embedded cover art are read from the tags; lyrics come from a sibling `.lrc` file first, then from embedded lyrics, and can also be attached by hand.
- **Full playback control.** Play/pause, previous/next, seek by dragging, volume, shuffle, and repeat-one. Space toggles playback.
- **Lyrics that follow the music.** Switch the left pane between cover art and synced lyrics, and click any line to jump to that moment.
- **Desktop lyrics overlay.** A frameless, always-on-top, fully transparent window that shows one line at a time with a blue-white gradient and a soft shimmer. Lines slide in and out on change, the shimmer pauses with the music, and the overlay is click-through by default so it never blocks the window underneath.
- **Themes.** Misty blue by default, follow the cover art, sample a color from a wallpaper, a neon breathing effect, plus adjustable window opacity.
- **Library tools.** Favorites with a heart filter, and search across title, artist, album, and folder.
- **Local persistence.** Library, favorites, volume, theme, and manually attached lyrics are stored locally — IndexedDB in the browser preview, the app config directory on desktop. The web build keeps file copies; the desktop build keeps original paths.

## Requirements

- Node.js 18+ and npm
- A Rust toolchain (stable)
- Tauri 2 platform prerequisites — on Linux that means GTK 3 and WebKitGTK 4.1
- **FFmpeg** (`ffmpeg` and `ffprobe` on `PATH`) — desktop builds only, used for audio decoding

## Getting started

```bash
npm install

npm run desktop   # run the Tauri desktop app
npm run dev       # browser preview at http://localhost:1420
```

The browser preview imports music through the file picker or drag and drop. The desktop lyrics overlay is only available in the desktop build.

## Desktop audio compatibility

WebKitGTK decodes some AAC and fragmented M4A streams differently from Chromium, which breaks seeking. The desktop build therefore uses FFmpeg locally to render a PCM WAV cache and plays it through a Blob created over binary IPC, so seeking behaves normally. The original files are untouched and no network access is involved. The cache lives in the app cache directory under `decoded-audio-v1`, evicts old entries automatically, and is capped at roughly 512 MiB. The currently playing decoded track is held in memory.

## Desktop lyrics overlay

The overlay is a transparent single-line window with clear blue-white gradient text and a moving shimmer rather than time-based coloring. When the line changes, the old one slides up and out while the new one slides in from below; the shimmer stops while playback is paused and is disabled entirely under "reduce motion". It has no toolbar, background card, blur, or window shadow — all management lives in the main player.

The main player's monitor button opens a menu where you can nudge the overlay into place ("Adjust position"), re-enable **click-through**, or close the overlay; every time it is reopened it starts click-through again.

The overlay remembers where you put it: the position is written to `lyrics-position.txt` in the app config directory as you drag, and restored on the next launch. Restored positions are checked against the currently connected monitors, so unplugging a second display never leaves the lyrics stranded off-screen.

GNOME Wayland does not honor keep-above requests for ordinary windows, so on Linux the app automatically selects the X11 backend when XWayland is available and `GDK_BACKEND` is not set explicitly — that is what keeps the lyrics on top and visible across workspaces. Native Wayland-only sessions remain limited by the compositor. Switching backends requires restarting the whole app.

## Tech stack

| Layer | Choice |
| --- | --- |
| Shell | Tauri 2 (`do.lori.player`), Rust backend |
| Frontend | React 19 + TypeScript, Vite |
| Icons | lucide-react |
| Tags (desktop) | [lofty](https://crates.io/crates/lofty) |
| Tags (web) | [music-metadata](https://www.npmjs.com/package/music-metadata) |
| Folder scan | [walkdir](https://crates.io/crates/walkdir) |
| Web persistence | [idb-keyval](https://www.npmjs.com/package/idb-keyval) |
| Decoding | FFmpeg subprocess (desktop) |

```
src/                  React UI, lyrics/LRC parsing, theme extraction
  library.ts          Track model, LRC parsing, active-line lookup, merge
  theme.ts            Dominant-hue extraction from cover art or wallpaper
  main.tsx            Player shell, playlist, overlay window, IPC
tests/                Playwright browser specs
src-tauri/src/lib.rs  Tauri commands: import, load_audio, overlay window
src-tauri/gen/        Tauri-generated ACL schemas
docs/screenshots/     Screenshots used by this README
```

## Testing

```bash
npm test                     # Vitest unit tests for library and theme helpers
npm run build                # TypeScript check + production frontend build
cargo check --manifest-path src-tauri/Cargo.toml

# Rust unit tests, including the real-sample test
LORI_TEST_MUSIC_DIR=/path/to/audio cargo test \
  --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture

# Playwright browser specs (uses an installed Google Chrome)
LORI_SAMPLE_DIR=/path/to/audio npm run test:browser
```

The browser specs and the ignored Rust test expect real local audio samples and are skipped or omitted unless you point them at a directory of your own files.

## Packaging

```bash
npm run tauri build
```

On Linux the bundle targets are deb and AppImage, and the deb declares a dependency on FFmpeg. Other platforms must be built on their own OS with FFmpeg installed. To run the built binary from your own account, install it and add a launcher, for example:

```bash
install -Dm755 src-tauri/target/release/lori-player ~/.local/bin/lori-player
```

## License

[MIT](LICENSE) © 2026 AliyahZombie

## Credits

Built on [Tauri](https://tauri.app/), [React](https://react.dev/), [Vite](https://vite.dev/), [lucide](https://lucide.dev/), [lofty](https://crates.io/crates/lofty), [music-metadata](https://www.npmjs.com/package/music-metadata), [walkdir](https://crates.io/crates/walkdir) and [FFmpeg](https://ffmpeg.org/). Thank you to the maintainers of all of them.

在桌面歌词菜单的「调整位置」模式中，可以实时调整文字大小（18–56 px）和不透明度（20%–100%），设置自动保存。窗口高度随字号适配，保持紧凑；「恢复默认」返回 34 px、100% 不透明度。
