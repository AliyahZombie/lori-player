# Windows builds

Lori targets Windows 10 22H2 / Windows 11, x64. Windows builds run in
[GitHub Actions](https://github.com/AliyahZombie/lori-player/actions/workflows/windows.yml);
no local Windows development environment is needed.

## Download

Open a successful **Windows build** run and download the
`Lori-Player-windows-x64-<commit>` artifact. Extract the archive and run the
`*-setup.exe` installer. `SHA256SUMS.txt` records the installer checksum.
Artifacts are retained for 30 days; these are CI builds, not signed releases.

The installer installs for the current user, offers Simplified Chinese and
English, and includes a private FFmpeg/ffprobe distribution. No global FFmpeg
installation or PATH change is required. If WebView2 is absent, its bootstrapper
requires an Internet connection. Playback itself works offline.

## Build and verification

The workflow runs on `windows-2022` with Node 22 and stable MSVC Rust. It runs
frontend unit tests, frontend production compilation, Rust tests (including real
FFmpeg decoding under a Chinese path), then builds an NSIS installer. Finally it
installs into a path containing spaces and Chinese characters, starts the
installed app, checks the main window and single-instance behavior, and uploads
a screenshot and log as `windows-smoke-evidence`.

Tauri automatically merges `src-tauri/tauri.windows.conf.json` on Windows. Linux
keeps its existing deb/AppImage configuration and system FFmpeg dependency.

For optional local Windows development, install the Tauri prerequisites (MSVC C++
build tools, Windows SDK, Rust, Node 22 and WebView2), then run in PowerShell:

```powershell
npm ci
./scripts/prepare-windows.ps1
npm run desktop
# Installer:
npm run tauri -- build --target x86_64-pc-windows-msvc --bundles nsis
```

Debug builds resolve FFmpeg inside `src-tauri/vendor/ffmpeg/bin`; release builds
resolve `ffmpeg/bin` beside the installed executable. The release executable
alone is not a portable distribution: its resource directory is required.
Child decoder processes use `CREATE_NO_WINDOW` to avoid flashing console windows.

The decoder download is a pinned monthly LGPL shared build from BtbN, with a
SHA-256 check. The full upstream archive contents are included, along with
`LORI-FFMPEG-NOTICE.txt` identifying source and build recipes. Upstream retains
monthly archives for two years. To update the decoder, update its release,
filename, checksum and source revision together in `prepare-windows.ps1`, then
rerun CI. Never bypass a checksum failure. Before a public release, retain the
corresponding dependency sources/build materials as required by their licenses.

## Data and manual acceptance

Keep the application identifier `do.lori.player` and WebView origin stable across
updates. Library and settings live in WebView local storage / IndexedDB;
configuration and cache paths are resolved by Tauri. Installing Windows does not
migrate Linux file paths. Reimport audio on Windows; listening-ledger JSON merges
identify original file contents using MD5, independently of operating-system paths.

CI startup checks do not prove audio output, desktop lyric transparency,
click-through, focus behavior, or mixed-DPI placement. Before describing Windows
as fully verified, check those interactions on a real desktop, including:

- Play/pause/seek for MP3, FLAC, WAV, AAC/M4A, Ogg/Opus and AIFF.
- Lyrics above ordinary windows, cursor pass-through, dragging and restoring position.
- 100%, 125%, 150%, 200% scaling, negative monitor coordinates and unplugged monitors.
- Tray hide/restore/exit, background playback, sleep/resume and persistence after restart.
- Installing an update over an existing installation without clearing user data.

Visibility on every Windows virtual desktop is not guaranteed by the existing
Tauri `visible_on_all_workspaces` call. No Windows-specific virtual desktop
integration is implemented.
