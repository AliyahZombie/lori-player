import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Music2,
  BarChart3,
  Search,
  Plus,
  FolderOpen,
  Heart,
  Disc3,
  ListMusic,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Shuffle,
  Repeat,
  Repeat1,
  Monitor,
  MousePointer2,
  LockKeyhole,
  X,
  AudioLines,
  Check,
  Upload,
  Palette,
  Settings2,
} from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { get, set } from "idb-keyval";
import { parseBlob } from "music-metadata";
import {
  activeLine,
  clock,
  mergeTracks,
  parseLrc,
  type Track,
} from "./library";
import { imageHue, type ThemeMode } from "./theme";
import { fingerprint } from "./fingerprint";
import { useListeningLedger } from "./use-listening-ledger";
import { Statistics } from "./Statistics";
import { Settings } from "./Settings";
import { useShortcuts } from "./use-shortcuts";
import { adjustedVolume } from "./shortcuts";
import "./style.css";
const native = isTauri();
type LyricState = {
  title: string;
  artist: string;
  line: string;
  next: string;
  playing: boolean;
  hue: number;
  neon: boolean;
  fontSize: number;
  opacity: number;
};
const initialLyric: LyricState = {
  title: "Lori Player",
  artist: "",
  line: "让喜欢的音乐，陪你一会儿",
  next: "播放本地歌曲后，歌词将在这里同步",
  playing: false,
  hue: 215,
  neon: true,
  fontSize: 34,
  opacity: 1,
};
function Cover({
  track,
  className = "",
}: {
  track?: Track;
  className?: string;
}) {
  return (
    <div className={`cover ${className}`}>
      {track?.cover ? (
        <img src={track.cover} alt={`${track.album} 封面`} />
      ) : (
        <>
          <div className="record">
            <i />
            <b />
          </div>
          <span className="cover-label">
            LORI
            <br />
            LOCAL COLLECTION
          </span>
        </>
      )}
    </div>
  );
}
function SlidingLyric({ line }: { line: string }) {
  const [frame, setFrame] = useState({ line, previous: "", sequence: 0 });
  if (frame.line !== line) {
    setFrame({ line, previous: frame.line, sequence: frame.sequence + 1 });
  }
  useEffect(() => {
    if (!frame.previous) return;
    const timer = window.setTimeout(
      () =>
        setFrame((current) =>
          current.sequence === frame.sequence
            ? { ...current, previous: "" }
            : current,
        ),
      420,
    );
    return () => clearTimeout(timer);
  }, [frame.sequence, frame.previous]);
  return (
    <>
      {frame.previous && (
        <div
          className="float-slide float-outgoing"
          key={`out-${frame.sequence}`}
          aria-hidden="true"
        >
          <span className="float-text">{frame.previous}</span>
        </div>
      )}
      <div
        className={`float-slide ${frame.sequence ? "float-incoming" : ""}`}
        key={`in-${frame.sequence}`}
      >
        <span className="float-text">{frame.line}</span>
      </div>
    </>
  );
}
function FloatingLyrics() {
  const drag = useRef<{
    pointer: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    latestX: number;
    latestY: number;
    scale: number;
    ready: boolean;
    busy: boolean;
  } | null>(null);
  async function moveOverlay() {
    const movement = drag.current;
    if (!movement || !movement.ready || movement.busy) return;
    movement.busy = true;
    try {
      do {
        const x = movement.latestX,
          y = movement.latestY;
        await getCurrentWindow().setPosition(
          new PhysicalPosition(
            Math.round(movement.x + (x - movement.startX) * movement.scale),
            Math.round(movement.y + (y - movement.startY) * movement.scale),
          ),
        );
        if (x === movement.latestX && y === movement.latestY) break;
      } while (drag.current === movement);
    } finally {
      movement.busy = false;
    }
  }

  const [state, update] = useState(initialLyric);
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--theme-hue",
      String(state.hue),
    );
    document.documentElement.dataset.neon = String(state.neon);
  }, [state.hue, state.neon]);
  useEffect(() => {
    let off: (() => void) | undefined;
    let disposed = false;
    listen<LyricState>("lyric-state", (e) => update(e.payload)).then((fn) => {
      if (disposed) fn();
      else {
        off = fn;
        void emit("lyric-ready");
      }
    });
    return () => {
      disposed = true;
      off?.();
    };
  }, []);
  return (
    <div
      className={`floating ${state.playing ? "is-playing" : ""}`}
      style={
        {
          "--lyric-font-size": `${state.fontSize ?? 34}px`,
          opacity: state.opacity ?? 1,
        } as React.CSSProperties
      }
    >
      <div
        className="float-line"
        aria-label={state.line}
        onPointerDown={async (event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          const movement = {
            pointer: event.pointerId,
            startX: event.screenX,
            startY: event.screenY,
            latestX: event.screenX,
            latestY: event.screenY,
            x: 0,
            y: 0,
            scale: 1,
            ready: false,
            busy: false,
          };
          drag.current = movement;
          try {
            const window = getCurrentWindow();
            const [position, scale] = await Promise.all([
              window.outerPosition(),
              window.scaleFactor(),
            ]);
            if (drag.current !== movement) return;
            Object.assign(movement, {
              x: position.x,
              y: position.y,
              scale,
              ready: true,
            });
            await moveOverlay();
          } catch {
            drag.current = null;
          }
        }}
        onPointerMove={(event) => {
          if (drag.current?.pointer !== event.pointerId) return;
          drag.current.latestX = event.screenX;
          drag.current.latestY = event.screenY;
          void moveOverlay().catch(() => {
            drag.current = null;
          });
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointer === event.pointerId) drag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      >
        <SlidingLyric line={state.line} />
      </div>
    </div>
  );
}
function App() {
  const [themeHue, setThemeHue] = useState(215);
  const [neon, setNeon] = useState(
    () => localStorage.getItem("lori-neon") !== "false",
  );
  const [opacity, setOpacity] = useState(() =>
    Number(localStorage.getItem("lori-opacity-v2") || 0.92),
  );
  useEffect(() => {
    document.documentElement.dataset.neon = String(neon);
    localStorage.setItem("lori-neon", String(neon));
  }, [neon]);
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--surface-opacity",
      String(opacity),
    );
    localStorage.setItem("lori-opacity-v2", String(opacity));
  }, [opacity]);
  const [theme, setTheme] = useState<ThemeMode>(
    () => (localStorage.getItem("lori-theme") as ThemeMode) || "blue",
  );
  const [wallpaperHue, setWallpaperHue] = useState(() =>
    Number(localStorage.getItem("lori-wallpaper-hue") || 215),
  );
  const [overlayMenu, setOverlayMenu] = useState(false);
  const [lyricFontSize, setLyricFontSize] = useState(() =>
    Math.max(
      18,
      Math.min(56, Number(localStorage.getItem("lori-lyric-size")) || 34),
    ),
  );
  const [lyricOpacity, setLyricOpacity] = useState(() =>
    Math.max(
      0.2,
      Math.min(1, Number(localStorage.getItem("lori-lyric-opacity")) || 1),
    ),
  );
  useEffect(() => {
    localStorage.setItem("lori-lyric-size", String(lyricFontSize));
    if (native)
      void invoke("resize_lyrics", { fontSize: lyricFontSize }).catch(() => {});
  }, [lyricFontSize]);
  useEffect(() => {
    localStorage.setItem("lori-lyric-opacity", String(lyricOpacity));
  }, [lyricOpacity]);
  const [overlayEditable, setOverlayEditable] = useState(false);
  const [overlayBusy, setOverlayBusy] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [statisticsOpen, setStatisticsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importMenu, setImportMenu] = useState(false);
  const wallpaperInput = useRef<HTMLInputElement>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [currentId, setCurrentId] = useState<string>();
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() =>
    Number(localStorage.getItem("lori-volume") ?? 0.7),
  );
  const [page, setPage] = useState("所有音乐");
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState<string[]>(() =>
    JSON.parse(localStorage.getItem("lori-favorites") || "[]"),
  );
  const [recent, setRecent] = useState<string[]>(() =>
    JSON.parse(localStorage.getItem("lori-recent") || "[]"),
  );
  const [mode, setMode] = useState<"order" | "shuffle" | "one">("order");
  const [showLyrics, setShowLyrics] = useState(false);
  const [queue, setQueue] = useState(false);
  const [notice, setNotice] = useState("");
  const audio = useRef<HTMLAudioElement>(null);
  const ledger = useListeningLedger(audio);
  const quitting = useRef(false);
  const quitRef = useRef(async () => {});
  quitRef.current = async () => {
    if (quitting.current) return;
    quitting.current = true;
    audio.current?.pause();
    ledger.stop();
    try {
      await ledger.checkpoint();
      await invoke("quit_app");
    } catch (error) {
      setNotice(`听歌记录保存失败，已取消退出，请重试：${String(error)}`);
      if (native) void invoke("focus_main").catch(() => {});
    } finally {
      quitting.current = false;
    }
  };
  const shortcuts = useShortcuts((action) => {
    if (settingsOpen || quitting.current) return;
    if (action === "previous") next(-1);
    else if (action === "next") next(1);
    else if (action === "toggle") toggle();
    else if (action === "volumeUp")
      setVolume((value) => adjustedVolume(value, 1));
    else if (action === "volumeDown")
      setVolume((value) => adjustedVolume(value, -1));
  });
  const files = useRef<HTMLInputElement>(null);
  const folders = useRef<HTMLInputElement>(null);
  const lrcInput = useRef<HTMLInputElement>(null);
  const current = tracks.find((t) => t.id === currentId);
  const wantPlay = useRef(false);
  const lines = useMemo(
    () => parseLrc(current?.lyrics ?? ""),
    [current?.lyrics],
  );
  const lineIndex = activeLine(lines, time);
  const hasLyrics = useMemo(
    () => lines.some((line) => line.text.trim().length > 0),
    [lines],
  );
  const lyricEl = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => {
    let list = tracks.filter(
      (t) =>
        (page !== "我喜欢的" || favorites.includes(t.id)) &&
        (page !== "最近播放" || recent.includes(t.id)) &&
        `${t.title} ${t.artist} ${t.album} ${t.folder}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
    if (page === "最近播放")
      list.sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id));
    return list;
  }, [tracks, query, page, favorites, recent]);
  useEffect(() => {
    void (async () => {
      try {
        const saved = await get<Track[]>("lori-library");
        if (saved?.length) {
          if (native) {
            const result = await invoke<{ tracks: Track[]; errors: string[] }>(
              "import_paths",
              { paths: saved.flatMap((t) => (t.path ? [t.path] : [])) },
            );
            setTracks(
              result.tracks.map((track) => {
                const stored = saved.find((item) => item.id === track.id);
                return stored?.customLyrics !== undefined
                  ? {
                      ...track,
                      lyrics: stored.customLyrics,
                      customLyrics: stored.customLyrics,
                    }
                  : track;
              }),
            );
            if (result.errors.length)
              setNotice(
                `${result.errors.length} 个文件暂时无法读取，请检查文件位置。`,
              );
          } else setTracks(saved.filter((t) => t.file));
        }
      } catch {
        setNotice("曲库恢复失败，可重新导入音乐。");
      } finally {
        setReady(true);
      }
    })();
  }, []);
  useEffect(() => {
    if (ready)
      void set("lori-library", tracks).catch(() =>
        setNotice("曲库保存失败，可能是存储空间不足。"),
      );
  }, [tracks, ready]);
  useEffect(() => {
    localStorage.setItem("lori-favorites", JSON.stringify(favorites));
  }, [favorites]);
  useEffect(() => {
    localStorage.setItem("lori-recent", JSON.stringify(recent));
  }, [recent]);
  useEffect(() => {
    if (audio.current) audio.current.volume = volume;
    localStorage.setItem("lori-volume", String(volume));
  }, [volume]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const el = audio.current;
    if (!el || !current) return;
    let cancelled = false;
    let url: string | undefined;
    el.pause();
    setLoadingAudio(true);
    setTime(0);
    setDuration(current.duration);
    void (async () => {
      try {
        const md5 = await fingerprint(current);
        if (cancelled) return;
        const blob =
          native && current.path
            ? new Blob(
                [
                  await invoke<ArrayBuffer>("load_audio", {
                    path: current.path,
                  }),
                ],
                { type: "audio/wav" },
              )
            : current.file;
        if (cancelled) return;
        if (!blob) throw new Error("文件不可用，请重新导入");
        ledger.setSong({
          songMd5: md5,
          fileName: (
            current.file?.name ??
            current.path?.split(/[\\/]/).pop() ??
            current.title
          ).slice(0, 4096),
          title: current.title.slice(0, 4096),
          artist: current.artist.slice(0, 4096),
        });
        url = URL.createObjectURL(blob);
        el.src = url;
        el.load();
        setLoadingAudio(false);
        if (wantPlay.current) await el.play();
      } catch (error) {
        if (cancelled) return;
        setLoadingAudio(false);
        setPlaying(false);
        setNotice(`播放失败：${String(error)}`);
      }
    })();
    return () => {
      cancelled = true;
      ledger.setSong();
      el.pause();
      el.removeAttribute("src");
      el.load();
      if (url) URL.revokeObjectURL(url);
    };
  }, [current?.id]);
  useEffect(() => {
    const container = lyricEl.current;
    const active = container?.querySelector<HTMLElement>(".lyric-active");
    if (container && active)
      container.scrollTo({
        top:
          active.offsetTop -
          container.clientHeight / 2 +
          active.clientHeight / 2,
        behavior: "smooth",
      });
  }, [lineIndex, showLyrics]);
  const lyricState: LyricState = {
    title: current?.title || "Lori Player",
    artist: current?.artist || "",
    line:
      lines[lineIndex]?.text ||
      (current
        ? hasLyrics
          ? "前奏 · 静静聆听"
          : "此刻，让音乐说话"
        : initialLyric.line),
    next:
      lines[lineIndex + 1]?.text ||
      (current && !hasLyrics ? "这首歌还没有同步歌词" : ""),
    playing,
    hue: themeHue,
    neon,
    fontSize: lyricFontSize,
    opacity: lyricOpacity,
  };
  const stateRef = useRef(lyricState);
  stateRef.current = lyricState;
  useEffect(() => {
    if (!native) return;
    void emit("lyric-state", lyricState);
    // The overlay is a lyric surface, not a poster: with nothing to read it
    // hides itself, and it floats back as soon as a lyric line exists again.
    void invoke("set_lyrics_visible", { visible: hasLyrics }).catch(() => {});
  }, [
    lyricState.line,
    lyricState.next,
    lyricState.title,
    hasLyrics,
    lyricFontSize,
    lyricOpacity,
    playing,
    themeHue,
    neon,
  ]);
  const toggleRef = useRef(() => {});
  toggleRef.current = toggle;
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    const offs: (() => void)[] = [];
    void Promise.all([
      listen("lyric-ready", () => void emit("lyric-state", stateRef.current)),
      listen("lori-quit-requested", () => void quitRef.current()),
    ]).then((list) => {
      if (disposed) list.forEach((f) => f());
      else {
        offs.push(...list);
        void invoke("player_ready").catch((error) =>
          setNotice(`播放器初始化失败：${String(error)}`),
        );
      }
    });
    return () => {
      disposed = true;
      offs.forEach((f) => f());
    };
  }, []);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        event.code === "Space" &&
        !event.defaultPrevented &&
        !event.repeat &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.shiftKey &&
        !document.querySelector("dialog[open]") &&
        !["INPUT", "TEXTAREA", "BUTTON"].includes(
          (event.target as HTMLElement).tagName,
        )
      ) {
        event.preventDefault();
        toggleRef.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  function select(t: Track) {
    wantPlay.current = true;
    if (t.id === currentId) {
      void audio.current
        ?.play()
        .catch(() => setNotice("播放失败，请检查文件。"));
    } else setCurrentId(t.id);
    setRecent((r) => [t.id, ...r.filter((id) => id !== t.id)].slice(0, 100));
  }
  function toggle() {
    if (loadingAudio) return;
    if (!current) {
      if (filtered[0]) select(filtered[0]);
      else setNotice("先导入一些喜欢的音乐吧。");
      return;
    }
    if (audio.current?.paused)
      void audio.current
        .play()
        .catch(() => setNotice("播放失败，请检查音频格式。"));
    else audio.current?.pause();
  }
  function next(delta = 1, ended = false) {
    if (mode === "one" && ended && audio.current) {
      audio.current.currentTime = 0;
      void audio.current.play();
      return;
    }
    const list = filtered.length ? filtered : tracks;
    if (!list.length) return;
    const idx = list.findIndex((t) => t.id === currentId);
    let index = (idx + delta + list.length) % list.length;
    if (mode === "shuffle" && list.length > 1) {
      const other = list.filter((t) => t.id !== currentId);
      select(other[Math.floor(Math.random() * other.length)]);
      return;
    }
    select(list[index]);
  }
  function seek(value: number) {
    if (audio.current && current) {
      ledger.stop();
      audio.current.currentTime = value;
      setTime(value);
    }
  }
  function favorite(id: string) {
    setFavorites((ids) =>
      ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id],
    );
  }
  async function importNative(directory: boolean) {
    if (busy || !ready) return;
    if (!native) {
      (directory ? folders : files).current?.click();
      return;
    }
    try {
      const selection = await open({
        directory,
        multiple: true,
        ...(!directory
          ? {
              filters: [
                {
                  name: "音乐",
                  extensions: [
                    "mp3",
                    "flac",
                    "wav",
                    "ogg",
                    "m4a",
                    "aac",
                    "opus",
                    "aiff",
                  ],
                },
              ],
            }
          : {}),
      });
      if (!selection) return;
      setBusy(true);
      const result = await invoke<{ tracks: Track[]; errors: string[] }>(
        "import_paths",
        { paths: Array.isArray(selection) ? selection : [selection] },
      );
      setTracks((old) => mergeTracks(old, result.tracks));
      setNotice(
        `已读取 ${result.tracks.length} 首音乐${result.errors.length ? `，${result.errors.length} 个文件读取失败` : ""}`,
      );
    } catch (e) {
      setNotice(`导入失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  }
  async function importBrowser(input: FileList | File[]) {
    if (busy || !ready) return;
    setBusy(true);
    const all = Array.from(input);
    const incoming: Track[] = [];
    let failed = 0;
    for (const file of all.filter((f) =>
      /\.(mp3|flac|wav|ogg|m4a|aac|opus|aiff)$/i.test(f.name),
    )) {
      try {
        const meta = await parseBlob(file);
        const pic = meta.common.picture?.[0];
        let cover: string | undefined;
        if (pic)
          cover = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.readAsDataURL(
              new Blob([new Uint8Array(pic.data)], { type: pic.format }),
            );
          });
        const lrc = all.find(
          (f) =>
            (f.webkitRelativePath || f.name).replace(/\.lrc$/i, "") ===
            (file.webkitRelativePath || file.name).replace(/\.[^.]+$/, ""),
        );
        incoming.push({
          id: `${file.webkitRelativePath || file.name}-${file.size}-${file.lastModified}`,
          file,
          title: meta.common.title || file.name.replace(/\.[^.]+$/, ""),
          artist: meta.common.artist || "未知艺术家",
          album: meta.common.album || "未命名专辑",
          duration: meta.format.duration || 0,
          cover,
          lyrics: lrc ? await lrc.text() : meta.common.lyrics?.[0]?.text || "",
          format: file.name.split(".").pop()!.toUpperCase(),
          folder:
            file.webkitRelativePath.split("/").slice(-2, -1)[0] || "导入的音乐",
        });
      } catch {
        failed++;
      }
    }
    setTracks((old) => mergeTracks(old, incoming));
    setBusy(false);
    setNotice(
      `已读取 ${incoming.length} 首音乐${failed ? `，${failed} 个文件读取失败` : ""}`,
    );
  }
  async function floating(editable = false) {
    if (overlayBusy) return;
    if (!native) {
      setNotice("全局悬浮歌词需要桌面版：运行 npm run desktop。");
      return;
    }
    try {
      setOverlayBusy(true);
      // The overlay hides itself while nothing is worth reading; telling the
      // native side up front avoids flashing placeholder text on the desktop.
      await invoke("open_lyrics", {
        editable,
        fontSize: lyricFontSize,
        show: hasLyrics,
      });
      await invoke("focus_main");
      void emit("lyric-state", stateRef.current);
      setOverlayEditable(editable);
      setOverlayMenu(true);
      if (!hasLyrics)
        setNotice("当前歌曲没有歌词，桌面歌词会在有歌词时自动显示。");
    } catch (e) {
      setNotice(`歌词窗口打开失败：${String(e)}`);
    } finally {
      setOverlayBusy(false);
    }
  }
  useEffect(() => {
    let cancelled = false;
    localStorage.setItem("lori-theme", theme);
    const apply = (hue: number) => {
      if (!cancelled) {
        document.documentElement.style.setProperty("--theme-hue", String(hue));
        setThemeHue(hue);
      }
    };
    apply(theme === "wallpaper" ? wallpaperHue : 215);
    if (theme === "cover" && current?.cover)
      void imageHue(current.cover)
        .then(apply)
        .catch(() => apply(215));
    return () => {
      cancelled = true;
    };
  }, [theme, wallpaperHue, current?.cover]);
  return (
    <div
      className={`app ${playing ? "is-playing" : ""}`}
      onPointerDownCapture={() => {
        if (native && !document.hasFocus())
          void invoke("focus_main").catch(() => {});
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (!native) void importBrowser(e.dataTransfer.files);
        else setNotice("请通过「导入音乐」选择本地文件或文件夹。");
      }}
    >
      <input
        ref={wallpaperInput}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const url = URL.createObjectURL(file);
          try {
            const hue = await imageHue(url);
            setWallpaperHue(hue);
            localStorage.setItem("lori-wallpaper-hue", String(hue));
            setTheme("wallpaper");
            setNotice("已从壁纸提取主题色，图片只在本机处理。");
          } catch {
            setNotice("无法读取这张图片，请选择 JPG、PNG 或 WebP。");
          } finally {
            URL.revokeObjectURL(url);
            e.target.value = "";
          }
        }}
      />
      <input
        ref={files}
        type="file"
        accept="audio/*,.lrc"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void importBrowser(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={folders}
        type="file"
        {...{ webkitdirectory: "" }}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void importBrowser(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={lrcInput}
        type="file"
        accept=".lrc"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          const id = currentId;
          if (f && id) {
            const lyrics = await f.text();
            setTracks((ts) =>
              ts.map((t) =>
                t.id === id ? { ...t, lyrics, customLyrics: lyrics } : t,
              ),
            );
          }
          e.target.value = "";
        }}
      />
      <aside className={`playlist ${queue ? "mobile-open" : ""}`}>
        <header className="playlist-header">
          <button
            className="icon-button"
            title="搜索音乐"
            onClick={() =>
              document.querySelector<HTMLInputElement>(".search input")?.focus()
            }
          >
            <Search size={17} />
          </button>
          <div>
            <h1>播放列表</h1>
            <p>
              {!ready ? (
                "正在读取曲库…"
              ) : (
                <>
                  {filtered.length} 首 ·{" "}
                  {Math.floor(
                    filtered.reduce((sum, t) => sum + t.duration, 0) / 60,
                  )}{" "}
                  分钟
                </>
              )}
            </p>
          </div>
          <button
            className={`icon-button ${page === "我喜欢的" ? "active" : ""}`}
            title={page === "我喜欢的" ? "显示全部音乐" : "只看喜欢的音乐"}
            onClick={() =>
              setPage(page === "我喜欢的" ? "所有音乐" : "我喜欢的")
            }
          >
            <Heart
              size={17}
              fill={page === "我喜欢的" ? "currentColor" : "none"}
            />
          </button>
        </header>
        <label className="search">
          <Search size={14} />
          <input
            aria-label="搜索音乐"
            placeholder="搜索你的音乐"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button title="清空搜索" onClick={() => setQuery("")}>
              <X size={13} />
            </button>
          )}
        </label>
        <div className="playlist-tracks">
          {!ready ? (
            <div
              className="playlist-loading"
              role="status"
              aria-live="polite"
              aria-label="正在加载已保存的歌曲"
            >
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  className="song-skeleton"
                  key={i}
                  aria-hidden="true"
                  style={
                    { "--row-delay": `${i * 110}ms` } as React.CSSProperties
                  }
                >
                  <span className="skeleton-cover" />
                  <span className="skeleton-text">
                    <i />
                    <i />
                  </span>
                </div>
              ))}
              <p className="playlist-loading-note">
                <span className="loading-ring" aria-hidden="true" />
                正在加载已保存的歌曲…
              </p>
            </div>
          ) : filtered.length ? (
            filtered.map((t) => (
              <div
                className={`song ${currentId === t.id ? "selected" : ""}`}
                key={t.id}
              >
                <button
                  className="song-main"
                  onClick={() => select(t)}
                  title={`${t.title} · ${t.artist}`}
                >
                  <Cover track={t} />
                  <span>
                    <strong>{t.title}</strong>
                    <small>{t.artist}</small>
                  </span>
                  {currentId === t.id && playing && <AudioLines size={15} />}
                </button>
                <button
                  className="song-remove"
                  title="从曲库移除，保留原文件"
                  onClick={() => {
                    if (t.id === currentId) {
                      audio.current?.pause();
                      setCurrentId(undefined);
                      setTime(0);
                      setDuration(0);
                    }
                    setTracks((ts) => ts.filter((x) => x.id !== t.id));
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            ))
          ) : (
            <div className="playlist-empty">
              <Music2 size={28} />
              <p>
                {query
                  ? "没有找到这首歌"
                  : page === "我喜欢的"
                    ? "还没有喜欢的歌曲"
                    : "把喜欢的音乐放进来"}
              </p>
              <span>
                {query ? "试试歌曲名或艺术家" : "支持本地歌曲和整个文件夹"}
              </span>
            </div>
          )}
        </div>
        <footer className="playlist-footer">
          <button
            title="听歌统计"
            aria-label="听歌统计"
            className="playlist-tool"
            onClick={() => {
              setImportMenu(false);
              setStatisticsOpen(true);
            }}
          >
            <BarChart3 size={16} />
          </button>
          <button
            title="设置"
            aria-label="设置"
            className="playlist-tool"
            onClick={() => {
              setImportMenu(false);
              setSettingsOpen(true);
            }}
          >
            <Settings2 size={17} />
            {shortcuts.error && <i className="settings-error-dot" />}
          </button>
          <button
            title="导入音乐"
            aria-expanded={importMenu}
            disabled={busy || !ready}
            onClick={() => setImportMenu(!importMenu)}
          >
            <FolderOpen size={17} />
          </button>
          {importMenu && (
            <div
              className="import-menu"
              onKeyDown={(event) => {
                if (event.key === "Escape") setImportMenu(false);
              }}
            >
              <button
                disabled={busy || !ready}
                onClick={() => {
                  setImportMenu(false);
                  void importNative(false);
                }}
              >
                选择音乐文件
              </button>
              <button
                title="导入文件夹"
                disabled={busy || !ready}
                onClick={() => {
                  setImportMenu(false);
                  void importNative(true);
                }}
              >
                选择音乐文件夹
              </button>
            </div>
          )}
        </footer>
      </aside>
      <main className="listening-room">
        <header className="window-bar">
          <span
            className="mini-brand"
            onPointerDown={() => {
              if (native) void getCurrentWindow().startDragging();
            }}
          >
            <AudioLines size={14} /> lori<span>本地音乐</span>
          </span>
          <div className="window-controls">
            <button
              title="主题与取色"
              aria-expanded={themeOpen}
              className={themeOpen ? "active" : ""}
              onClick={() => setThemeOpen(!themeOpen)}
            >
              <Palette size={16} />
            </button>
            {native && (
              <>
                <button
                  title="最小化"
                  onClick={() => void getCurrentWindow().minimize()}
                >
                  <span>−</span>
                </button>
                <button
                  title="最大化 / 还原"
                  onClick={() => void getCurrentWindow().toggleMaximize()}
                >
                  <span>□</span>
                </button>
                <button
                  title="关闭窗口（保留后台播放）"
                  onClick={() =>
                    void invoke("hide_main").catch((error) =>
                      setNotice(`隐藏窗口失败：${String(error)}`),
                    )
                  }
                >
                  <X size={14} />
                </button>
              </>
            )}
          </div>
        </header>
        <div
          className={`listening-content ${showLyrics && current ? "lyrics-mode" : ""}`}
        >
          <div className="artwork-stage">
            {showLyrics && current ? (
              <div className="lyrics" ref={lyricEl}>
                {lines.length ? (
                  lines.map((line, i) => (
                    <button
                      className={i === lineIndex ? "lyric-active" : ""}
                      key={`${i}-${line.time}`}
                      onClick={() => seek(line.time)}
                    >
                      {line.text || "♪"}
                    </button>
                  ))
                ) : (
                  <div className="no-lyrics">
                    <Music2 size={26} />
                    <p>此刻，让音乐说话</p>
                    <button onClick={() => lrcInput.current?.click()}>
                      <Plus size={14} /> 添加 LRC 歌词
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Cover track={current} className="big-cover" />
            )}
          </div>
          <div className="song-info" aria-hidden={showLyrics && !!current}>
            <h2 title={current?.title}>{current?.title || "听点喜欢的"}</h2>
            <p>
              {loadingAudio
                ? "正在准备本地音频…"
                : current?.artist || "你的音乐，你的节奏"}
            </p>
            <span>
              {current?.album === "未命名专辑"
                ? current.folder
                : current?.album || "从本地收藏开始"}
            </span>
          </div>
          <div className="seek-bar">
            <input
              aria-label="播放进度"
              type="range"
              min="0"
              max={duration || 1}
              step="0.1"
              value={Math.min(time, duration || 1)}
              disabled={!current}
              onChange={(e) => seek(Number(e.target.value))}
              style={
                {
                  "--progress": `${duration ? (time / duration) * 100 : 0}%`,
                } as React.CSSProperties
              }
            />
            <div>
              <span>{clock(time)}</span>
              <span>
                {current ? `−${clock(Math.max(0, duration - time))}` : "0:00"}
              </span>
            </div>
          </div>
          <div className="transport">
            <button
              title="上一首"
              disabled={!tracks.length}
              onClick={() => next(-1)}
            >
              <SkipBack size={21} fill="currentColor" />
            </button>
            <button
              className={`play-button ${loadingAudio ? "loading-audio" : ""}`}
              disabled={loadingAudio}
              title={playing ? "暂停" : "播放"}
              onClick={toggle}
            >
              {playing ? (
                <Pause size={25} fill="currentColor" />
              ) : (
                <Play size={25} fill="currentColor" />
              )}
            </button>
            <button
              title="下一首"
              disabled={!tracks.length}
              onClick={() => next()}
            >
              <SkipForward size={21} fill="currentColor" />
            </button>
          </div>
          <div className="volume">
            <button
              title={volume ? "静音" : "取消静音"}
              onClick={() => setVolume(volume ? 0 : 0.7)}
            >
              {volume ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
            <input
              type="range"
              aria-label="音量"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              style={
                { "--progress": `${volume * 100}%` } as React.CSSProperties
              }
            />
            <Volume2 size={16} />
          </div>
          <div className="playback-tools">
            <button
              className={showLyrics ? "active" : ""}
              title="显示 / 隐藏歌词"
              onClick={() => setShowLyrics(!showLyrics)}
            >
              <span>词</span>
            </button>
            <button
              className={mode === "shuffle" ? "active" : ""}
              title="随机播放"
              onClick={() => setMode(mode === "shuffle" ? "order" : "shuffle")}
            >
              <Shuffle size={18} />
            </button>
            <button
              className={
                current && favorites.includes(current.id) ? "active" : ""
              }
              title="喜欢这首歌"
              disabled={!current}
              onClick={() => current && favorite(current.id)}
            >
              <Heart
                size={18}
                fill={
                  current && favorites.includes(current.id)
                    ? "currentColor"
                    : "none"
                }
              />
            </button>
            <button
              className={mode === "one" ? "active" : ""}
              title={mode === "one" ? "单曲循环" : "列表循环"}
              onClick={() => setMode(mode === "one" ? "order" : "one")}
            >
              {mode === "one" ? <Repeat1 size={18} /> : <Repeat size={18} />}
            </button>
            <div className="overlay-controls">
              <button
                title="桌面悬浮歌词"
                aria-expanded={overlayMenu}
                disabled={overlayBusy}
                onClick={() =>
                  overlayMenu ? setOverlayMenu(false) : void floating()
                }
              >
                <Monitor size={18} />
              </button>
              {overlayMenu && (
                <div className="overlay-menu">
                  <header>
                    <strong>桌面歌词</strong>
                    <button
                      title="收起歌词设置"
                      onClick={() => setOverlayMenu(false)}
                    >
                      <X size={14} />
                    </button>
                  </header>
                  <button
                    disabled={overlayBusy}
                    className={!overlayEditable ? "active" : ""}
                    onClick={() => void floating(false)}
                  >
                    <LockKeyhole size={16} />
                    <span>
                      鼠标穿透<small>点击直接落到下方窗口</small>
                    </span>
                    {!overlayEditable && <Check size={14} />}
                  </button>
                  <button
                    disabled={overlayBusy}
                    className={overlayEditable ? "active" : ""}
                    onClick={() => void floating(true)}
                  >
                    <MousePointer2 size={16} />
                    <span>
                      调整位置<small>临时允许拖动和操作歌词</small>
                    </span>
                    {overlayEditable && <Check size={14} />}
                  </button>
                  {overlayEditable && (
                    <div className="overlay-appearance">
                      <label>
                        <span>
                          文字大小<b>{lyricFontSize} px</b>
                        </span>
                        <input
                          aria-label="桌面歌词文字大小"
                          type="range"
                          min="18"
                          max="56"
                          step="1"
                          value={lyricFontSize}
                          onChange={(e) =>
                            setLyricFontSize(Number(e.target.value))
                          }
                        />
                      </label>
                      <label>
                        <span>
                          不透明度<b>{Math.round(lyricOpacity * 100)}%</b>
                        </span>
                        <input
                          aria-label="桌面歌词不透明度"
                          type="range"
                          min="0.2"
                          max="1"
                          step="0.05"
                          value={lyricOpacity}
                          onChange={(e) =>
                            setLyricOpacity(Number(e.target.value))
                          }
                        />
                      </label>
                      <button
                        onClick={() => {
                          setLyricFontSize(34);
                          setLyricOpacity(1);
                        }}
                      >
                        恢复默认
                      </button>
                    </div>
                  )}
                  <button
                    disabled={overlayBusy}
                    onClick={async () => {
                      setOverlayBusy(true);
                      try {
                        await invoke("close_lyrics");
                        setOverlayMenu(false);
                      } catch (error) {
                        setNotice(`关闭歌词失败：${String(error)}`);
                      } finally {
                        setOverlayBusy(false);
                      }
                    }}
                  >
                    <X size={16} />
                    <span>关闭桌面歌词</span>
                  </button>
                </div>
              )}
            </div>
            <button
              className="mobile-list"
              title="播放列表"
              onClick={() => setQueue(!queue)}
            >
              <ListMusic size={18} />
            </button>
          </div>
          {current && (
            <button
              className="lyric-import"
              onClick={() => lrcInput.current?.click()}
            >
              <Upload size={11} />
              {lines.length ? "更换歌词" : "添加歌词"}
              <span>· {current.format}</span>
            </button>
          )}
        </div>
        {themeOpen && (
          <div className="theme-menu">
            <header>
              <strong>外观</strong>
              <button title="关闭主题设置" onClick={() => setThemeOpen(false)}>
                <X size={16} />
              </button>
            </header>
            <p>一点颜色，一点自己的风格。</p>
            <button
              className={theme === "blue" ? "theme-selected" : ""}
              onClick={() => setTheme("blue")}
            >
              <span className="theme-dot blue-dot" />
              <span>
                雾蓝<small>默认主题</small>
              </span>
              {theme === "blue" && <Check size={16} />}
            </button>
            <button
              className={theme === "cover" ? "theme-selected" : ""}
              onClick={() => setTheme("cover")}
            >
              <Disc3 size={22} />
              <span>
                跟随封面<small>从歌曲封面提取氛围色</small>
              </span>
              {theme === "cover" && <Check size={16} />}
            </button>
            <button
              className={theme === "wallpaper" ? "theme-selected" : ""}
              onClick={() => wallpaperInput.current?.click()}
            >
              <span className="theme-dot wallpaper-dot" />
              <span>
                壁纸取色<small>选择一张喜欢的图片</small>
              </span>
              <Upload size={15} />
            </button>
            <label className="theme-switch">
              <span>霓虹柔光</span>
              <input
                aria-label="霓虹柔光"
                type="checkbox"
                checked={neon}
                onChange={(e) => setNeon(e.target.checked)}
              />
            </label>
            <label className="opacity-control">
              <span>
                不透明度 <b>{Math.round(opacity * 100)}%</b>
              </span>
              <input
                aria-label="窗口不透明度"
                type="range"
                min="0.5"
                max="1"
                step="0.01"
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
              />
            </label>
            <small className="theme-note">本地取色 · 没有封面时保持雾蓝</small>
          </div>
        )}
      </main>
      {settingsOpen && (
        <Settings {...shortcuts} onClose={() => setSettingsOpen(false)} />
      )}
      {statisticsOpen && (
        <Statistics
          onClose={() => setStatisticsOpen(false)}
          checkpoint={ledger.checkpoint}
          recordingError={ledger.error}
        />
      )}
      {ledger.error && !statisticsOpen && (
        <div
          className="ledger-warning"
          role="alert"
          onClick={() => setStatisticsOpen(true)}
        >
          {ledger.error}
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button title="关闭提示" onClick={() => setNotice("")}>
            <X size={16} />
          </button>
        </div>
      )}
      <audio
        ref={audio}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => setTime(audio.current?.currentTime || 0)}
        onLoadedMetadata={() =>
          setDuration(audio.current?.duration || current?.duration || 0)
        }
        onEnded={() => next(1, true)}
        onError={() => {
          setPlaying(false);
          if (current)
            setNotice("无法解码此音频，请确认文件可用或尝试其他格式。");
        }}
      />
    </div>
  );
}
if (native) document.documentElement.classList.add("native-app");
const floatingWindow = new URLSearchParams(location.search).has("lyrics");
if (floatingWindow) document.documentElement.classList.add("lyric-window");
createRoot(document.getElementById("root")!).render(
  floatingWindow ? <FloatingLyrics /> : <App />,
);
