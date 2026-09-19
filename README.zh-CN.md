# Lori Player

**给本地音乐一个安静的家。**

用 Tauri 2 + React 写的紧凑桌面播放器：左侧播放或显示歌词，右侧管理歌单。所有数据都留在你自己的机器上 —— 不需要账号、不发起网络请求，也不会移动、重命名或改写你的音频文件。

[English](README.md) · [简体中文](README.zh-CN.md)

![license: MIT](https://img.shields.io/badge/license-MIT-blue)
![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB)
![React 19](https://img.shields.io/badge/React-19-61DAFB)
![platform: Linux](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey)

<p align="center">
  <img src="docs/screenshots/player-cover.png" width="400" alt="Lori Player 显示封面、播放控制与歌单">
  <img src="docs/screenshots/player-lyrics.png" width="400" alt="Lori Player 显示同步歌词与歌单">
</p>
<p align="center">
  <img src="docs/screenshots/lyrics-overlay.png" width="400" alt="置顶的桌面歌词悬浮窗，叠加在深色背景上展示">
</p>

## 功能

- **文件始终属于你。** 用 `+` 导入歌曲，或用文件夹按钮递归导入；不会移动、复制或重新写入标签，从曲库移除歌曲也不会删除磁盘上的文件。
- **直接读取已有元数据。** 标题、艺术家和内嵌封面来自音频标签；歌词优先加载同目录同名 `.lrc`，其次读取内嵌歌词，也可以手动添加。
- **完整的播放控制。** 播放/暂停、上一首/下一首、拖动进度、音量、随机和单曲循环，空格切换播放。
- **跟着音乐走的歌词。** 左侧可在封面与同步歌词之间切换，点击任意一句即可跳转到对应时间。
- **桌面歌词悬浮窗。** 无边框、置顶、完全透明，一次显示一行清晰的蓝白渐变文字并带柔和流光。换句时旧句向上退出、新句从下方滑入；暂停时流光停止。默认开启鼠标穿透，不会挡住下方窗口。
- **主题。** 默认雾蓝，可跟随封面、从所选壁纸取色、开启霓虹呼吸效果，并调整窗口不透明度。
- **曲库工具。** 爱心收藏与收藏筛选，支持按歌曲、艺术家、专辑或文件夹搜索。
- **本地持久化。** 曲库、收藏、音量、主题和手动导入的歌词都保存在本地 —— 网页预览用 IndexedDB，桌面版存应用配置目录。网页曲库保存文件副本，桌面曲库保存原文件路径。

## 环境依赖

- Node.js 18+ 与 npm
- Rust 工具链（stable）
- Tauri 2 对应平台依赖，Linux 上为 GTK 3 和 WebKitGTK 4.1
- **FFmpeg**（`ffmpeg` 与 `ffprobe` 在 `PATH` 中）—— 仅桌面版需要，用于音频解码

## 快速开始

```bash
npm install

npm run desktop   # 运行 Tauri 桌面应用
npm run dev       # 浏览器预览 http://localhost:1420
```

浏览器预览通过文件选择或拖放导入音乐；桌面歌词悬浮窗仅在桌面版可用。

## 桌面音频兼容

WebKitGTK 对部分 AAC / 分段 M4A 的解码与 Chromium 不同，会导致跳转失效。桌面版因此用 FFmpeg 在本地生成 PCM WAV 缓存，再通过二进制 IPC 创建 Blob 播放，跳转即可正常工作。原文件保持不变，整个过程不访问网络。缓存位于应用缓存目录的 `decoded-audio-v1`，会自动淘汰旧条目，目标上限约 512 MiB；当前播放的解码结果会加载到内存中。

## 桌面歌词悬浮窗

悬浮窗是一条透明的单行歌词，采用清晰的蓝白渐变文字和动态流光，而不是按时间逐渐染色。换句时旧句向上退出、新句从下方滑入；暂停时流光停止，「减少动态效果」下动画整体禁用。窗口没有操作栏、背景卡片、模糊或窗口阴影，所有管理入口都集中在主播放器。

主播放器的显示器按钮会展开菜单：可以「调整位置」临时拖动，可以重新开启**鼠标穿透**，也可以直接关闭桌面歌词；每次重新打开都默认恢复穿透。

悬浮窗会记住你放的位置：拖动时位置写入应用配置目录的 `lyrics-position.txt`，下次启动自动恢复。恢复前会检查当前连接的显示器可见区域，因此拔掉副屏后歌词也不会跑到屏幕外。

GNOME Wayland 不支持普通窗口的 keep-above 请求，因此 Linux 上会在 XWayland 可用且未显式设置 `GDK_BACKEND` 时自动选择 X11 后端，确保歌词置顶并跨工作区显示。原生 Wayland-only 环境仍受合成器限制。此后端切换需要重启整个应用。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 外壳 | Tauri 2（`do.lori.player`），Rust 后端 |
| 前端 | React 19 + TypeScript、Vite |
| 图标 | lucide-react |
| 标签读取（桌面） | [lofty](https://crates.io/crates/lofty) |
| 标签读取（网页） | [music-metadata](https://www.npmjs.com/package/music-metadata) |
| 目录扫描 | [walkdir](https://crates.io/crates/walkdir) |
| 网页持久化 | [idb-keyval](https://www.npmjs.com/package/idb-keyval) |
| 解码 | FFmpeg 子进程（桌面） |

```
src/                  React 界面、歌词/LRC 解析、主题取色
  library.ts          Track 模型、LRC 解析、当前行查找、合并
  theme.ts            从封面或壁纸提取主色调
  main.tsx            播放器外壳、歌单、悬浮窗、IPC
tests/                Playwright 浏览器测试
src-tauri/src/lib.rs  Tauri 命令：导入、load_audio、悬浮窗
src-tauri/gen/        Tauri 生成的 ACL schema
docs/screenshots/     本 README 使用的截图
```

## 测试

```bash
npm test                     # library 与 theme 的 Vitest 单元测试
npm run build                # TypeScript 检查 + 前端生产构建
cargo check --manifest-path src-tauri/Cargo.toml

# Rust 单元测试，包含真实样本测试
LORI_TEST_MUSIC_DIR=/path/to/audio cargo test \
  --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture

# Playwright 浏览器测试（使用本机安装的 Google Chrome）
LORI_SAMPLE_DIR=/path/to/audio npm run test:browser
```

浏览器测试与标记为 ignored 的 Rust 测试需要真实本地音频样本，不指定目录时会跳过。

## 打包

```bash
npm run tauri build
```

Linux 打包目标为 deb / AppImage，deb 声明 FFmpeg 依赖。其他平台需要在对应系统上构建，并安装 FFmpeg。想把构建好的二进制装到当前账户使用：

```bash
install -Dm755 src-tauri/target/release/lori-player ~/.local/bin/lori-player
```

## 许可证

[MIT](LICENSE) © 2026 AliyahZombie

## 致谢

构建于 [Tauri](https://tauri.app/)、[React](https://react.dev/)、[Vite](https://vite.dev/)、[lucide](https://lucide.dev/)、[lofty](https://crates.io/crates/lofty)、[music-metadata](https://www.npmjs.com/package/music-metadata)、[walkdir](https://crates.io/crates/walkdir) 与 [FFmpeg](https://ffmpeg.org/)。感谢所有这些项目的维护者。
