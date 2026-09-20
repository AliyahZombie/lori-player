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

- **文件始终属于你。** 用文件夹按钮选择歌曲文件或递归导入整个文件夹；不会移动、复制或重新写入标签，从曲库移除歌曲也不会删除磁盘上的文件。
- **直接读取已有元数据。** 标题、艺术家和内嵌封面来自音频标签；歌词优先加载同目录同名 `.lrc`，其次读取内嵌歌词，也可以手动添加。
- **完整的播放控制。** 播放/暂停、上一首/下一首、拖动进度、音量、随机和单曲循环，空格切换播放。
- **跟着音乐走的歌词。** 左侧可在封面与同步歌词之间切换，点击任意一句即可跳转到对应时间。
- **桌面歌词悬浮窗。** 无边框、置顶、完全透明，一次显示一行清晰的蓝白渐变文字并带柔和流光。换句时旧句向上退出、新句从下方滑入；暂停时流光停止。默认开启鼠标穿透，不会挡住下方窗口；没有歌词时自动隐藏。
- **主题。** 默认雾蓝，可跟随封面、从所选壁纸取色、开启霓虹呼吸效果，并调整窗口不透明度。
- **曲库工具。** 爱心收藏与收藏筛选，支持按歌曲、艺术家、专辑或文件夹搜索。
- **听歌统计。** 播放列表底部的统计按钮提供日期筛选、歌曲排行、每日时长和时间段明细。JSON 账本可导入、导出并直接合并。
- **本地持久化。** 曲库、收藏、音量、主题和手动导入的歌词都保存在本地 —— 网页预览用 IndexedDB，桌面版存应用配置目录。网页曲库保存文件副本，桌面曲库保存原文件路径。

## 听歌账本

统计从本次更新后的实际播放开始，不会用曲库时长或「最近播放」补造过去的记录。歌曲按**原始文件完整内容的 MD5** 识别，文件名、标题和艺术家仅作为显示标记；改名或移动同一文件不会拆分统计，修改文件内容（包括标签）则会产生新的 MD5。移除曲库歌曲不会删除听歌历史。

- 使用单调时钟和媒体播放进度共同确认实际播放。暂停、缓冲、拖动跳过的内容不计时；倍速按现实经过的时间计，静音播放仍计时。检测到休眠、时钟跳变或超过 5 秒的采样空档时，不推算空档时长。
- 每个连续播放段最多 60 秒，每秒更新当前段的检查点；暂停、切歌和正常关闭桌面窗口时立即保存。异常强退只能恢复最后成功落盘的检查点，通常可能丢失最后约 1 秒；长时间冻结可能丢失更多未观测时间。保存失败会提示并保留待重试数据。
- 独立 IndexedDB 数据库 `lori-listening-ledger`，桌面版位于 WebView 的本地应用数据中。按开始时间与「MD5 + 开始时间」建索引，分页读取明细；历史汇总使用可失效的内存缓存，实时刷新只扫描新近账本。汇总从账本重建，不保存独立累计计数器。
- 总时长为选定范围内所有区间的并集，歌曲时长为该 MD5 的区间并集。跨设备同时播放不同歌曲时，各歌曲时长之和可以大于总时长。每日统计按查看设备的本地时区切分；账本本身使用 UTC 毫秒和左闭右开区间。
- 「导出全部」始终包含完整账本；「导入账本」在单个事务中合并，不覆盖已有历史。相同记录编号保留更长的检查点，重复导入不增加时长；不同编号的重叠区间也会去重。同一编号的歌曲、开始时间或原始标记发生冲突时，整次导入回滚。可依次导入多个账本。

导出格式与合并规则见 [账本格式说明](docs/listening-ledger.md)。

## 环境依赖

- Node.js 18+ 与 npm
- Rust 工具链（stable）
- Tauri 2 对应平台依赖，Linux 上为 GTK 3 和 WebKitGTK 4.1
- **FFmpeg** —— Windows 安装包已内置；Linux/macOS 需将 `ffmpeg` 与 `ffprobe` 放入 `PATH`，用于桌面音频解码

## 快速开始

```bash
npm install

npm run desktop   # 运行 Tauri 桌面应用
npm run dev       # 浏览器预览 http://localhost:1420
```

浏览器预览通过文件选择或拖放导入音乐；桌面歌词悬浮窗仅在桌面版可用。

## 系统托盘

点击主窗口右上角的 × 或按 Alt+F4 只隐藏窗口，音乐和桌面歌词继续运行。从系统托盘菜单选择「显示播放器」恢复窗口，选择「退出播放器」才会完全退出。再次从应用菜单或命令行启动 Lori，也会恢复已有窗口，不会重复启动播放器。

Linux 使用系统的 StatusNotifier/AppIndicator 托盘；Windows/macOS 也可左键点击托盘图标恢复窗口。

## 桌面音频兼容

WebKitGTK 对部分 AAC / 分段 M4A 的解码与 Chromium 不同，会导致跳转失效。桌面版因此用 FFmpeg 在本地生成 PCM WAV 缓存，再通过二进制 IPC 创建 Blob 播放，跳转即可正常工作。原文件保持不变，整个过程不访问网络。缓存位于应用缓存目录的 `decoded-audio-v1`，会自动淘汰旧条目，目标上限约 512 MiB；当前播放的解码结果会加载到内存中。

## 桌面歌词悬浮窗

悬浮窗是一条透明的单行歌词，采用清晰的蓝白渐变文字和动态流光，而不是按时间逐渐染色。换句时旧句向上退出、新句从下方滑入；暂停时流光停止，「减少动态效果」下动画整体禁用。窗口没有操作栏、背景卡片、模糊或窗口阴影，所有管理入口都集中在主播放器。

悬浮窗只在确有歌词可读时出现：当前歌曲没有歌词（或还没选歌）时它会自动隐藏，等切到有歌词的歌曲再自己浮回来，因此不会把「此刻，让音乐说话」这类占位文字一直摆在桌面上。在无歌词时打开桌面歌词，主播放器会提示这一点，歌词窗口则在后台待命。

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
npm test                     # 曲库、主题、账本演算与计时边界测试
npm run build                # TypeScript 检查 + 前端生产构建
cargo check --manifest-path src-tauri/Cargo.toml

# Rust 单元测试，包含真实样本测试
LORI_TEST_MUSIC_DIR=/path/to/audio cargo test \
  --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture

# Playwright 浏览器测试（使用本机安装的 Google Chrome）
LORI_SAMPLE_DIR=/path/to/audio npm run test:browser
```

统计浏览器测试使用自动生成的 WAV，验证真实播放、MD5、暂停/跳转、合并、导出和持久化，无需外部样本。原有真实曲库浏览器测试与标记为 ignored 的 Rust 测试仍需指定样本目录。

## 打包

```bash
npm run tauri build
```

Windows x64 通过 [GitHub Actions](https://github.com/AliyahZombie/lori-player/actions/workflows/windows.yml) 构建 NSIS 安装包，内置 FFmpeg，并在缺少 WebView2 时联网安装。下载成功运行的 `Lori-Player-windows-x64-<commit>` 构建产物即可；无需自行配置 Windows 开发环境。当前为未签名 CI 构建，验证范围和细节见 [Windows 构建说明](docs/windows.md)。

Linux 打包目标为 deb / AppImage，deb 声明 FFmpeg 依赖。想把构建好的 Linux 二进制装到当前账户使用：

```bash
install -Dm755 src-tauri/target/release/lori-player ~/.local/bin/lori-player
```

## 许可证

[MIT](LICENSE) © 2026 AliyahZombie

## 致谢

构建于 [Tauri](https://tauri.app/)、[React](https://react.dev/)、[Vite](https://vite.dev/)、[lucide](https://lucide.dev/)、[lofty](https://crates.io/crates/lofty)、[music-metadata](https://www.npmjs.com/package/music-metadata)、[walkdir](https://crates.io/crates/walkdir) 与 [FFmpeg](https://ffmpeg.org/)。感谢所有这些项目的维护者。
