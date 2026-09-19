# Lori Player

紧凑的本地音乐播放器，Tauri 2 + React。左侧播放或显示歌词，右侧管理歌单。

## 启动

```bash
npm install
npm run desktop
```

桌面版需要 Rust、Tauri 平台依赖和 **FFmpeg**（`ffmpeg` / `ffprobe` 在 PATH 中）。当前机器已具备这些依赖。Linux 开发依赖包括 GTK 3 和 WebKitGTK 4.1。

网页预览：`npm run dev`，打开 http://localhost:1420 。网页通过文件选择或拖放导入音乐，桌面悬浮歌词仅桌面版可用。

## 使用

- 歌单底部 `+` 导入歌曲，文件夹按钮递归导入。不会修改或移动原文件。
- 点击歌曲播放；支持暂停、上一首/下一首、拖动进度、音量、随机和单曲循环。空格切换播放。
- 自动读取标题、艺术家、内嵌封面；歌词优先加载同目录同名 `.lrc`，其次读取内嵌歌词，也可手动添加。
- 下方「词」在封面和同步歌词之间切换，点击歌词跳转对应时间；显示器按钮打开置顶、可拖动的桌面歌词，并同步播放、暂停和主题颜色。
- 爱心收藏歌曲，歌单顶部爱心筛选收藏；搜索歌曲、艺术家、专辑或文件夹。歌曲悬停后的 `×` 只移出曲库，不删除原文件。
- 右上调色盘：默认雾蓝、跟随封面、从所选壁纸取色、霓虹呼吸效果和窗口不透明度。默认深色半透明背景；操作系统合成器决定最终桌面透明效果，CSS 模糊不能保证模糊窗口背后的其他应用。
- 曲库、收藏、音量、主题和手动导入歌词在本地保存。网页曲库保存文件副本，桌面曲库保存原文件路径。

## 桌面音频兼容

WebKitGTK 对部分 AAC / 分段 M4A 的解码与 Chromium 不同。桌面版使用 FFmpeg 在本地生成 PCM WAV 缓存，再通过二进制 IPC 创建 Blob 播放，支持正常跳转。原文件保持不变，不访问网络。缓存位于应用缓存目录的 `decoded-audio-v1`，自动淘汰旧缓存，目标上限 512 MiB。播放时会将当前解码后的歌曲加载到内存。

## 验证与打包

```bash
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml

# 使用真实本地样本执行导入、播放、跳转、歌词、取色和持久化测试
# 浏览器测试使用本机 Google Chrome
LORI_SAMPLE_DIR="$HOME/tmp/bili-songs/output/sample" npm run test:browser
LORI_TEST_MUSIC_DIR="$HOME/tmp/bili-songs/output/sample" cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture

npm run tauri build
```

Linux 打包目标为 deb / AppImage；deb 声明 FFmpeg 依赖。其他平台需要在对应系统上构建，并安装 FFmpeg。已注册到 Toolbox：`lori-player`。

### 无背景桌面歌词

桌面歌词为透明单行文字，清晰的蓝白渐变文字带动态流光，不再按时间逐渐染色。换句时旧句向上退出、新句从下方滑入，暂停时流光停止，减少动态效果设置下禁用动画。悬浮窗口只显示歌词，无操作栏、下一句、背景卡片、模糊或窗口阴影；管理入口统一在主播放器。

GNOME Wayland 不支持普通窗口的 keep-above 请求，因此 Linux 在 XWayland 可用且未显式设置 `GDK_BACKEND` 时自动选择 X11 后端，确保歌词置顶并跨工作区显示。原生 Wayland-only 环境仍受合成器限制。此后端切换需要重启整个应用。

桌面歌词默认启用操作系统级鼠标穿透，文字及透明区域都不会拦截下方窗口。主播放器的显示器按钮展开菜单，可切换「调整位置」临时拖动，再选择「鼠标穿透」恢复锁定；也能直接关闭桌面歌词。每次重新打开默认恢复穿透。

## 当前账户安装

正式版已安装至 `~/.local/bin/lori-player`，启动器入口为 `~/.local/share/applications/do.lori.player.desktop`。在应用列表搜索「Lori」即可启动，或运行 `lori-player`。Toolbox 同步使用已安装版本。更新源码后需重新构建并安装二进制。

界面文字禁用选中，搜索框等可编辑内容仍支持正常选择和编辑。桌面歌词的位置保存在应用配置目录 `lyrics-position.txt`，重开窗口和重启应用后恢复；会检查显示器可见区域，避免断开副屏后歌词跑到屏幕外。GNOME 启动器入口同时已固定至 Dock。
