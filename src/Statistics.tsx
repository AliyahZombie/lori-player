import { useEffect, useRef, useState } from "react";
import {
  BarChart3,
  Calendar,
  Clock,
  Download,
  FolderOpen,
  Music2,
  Upload,
  X,
  ArrowLeft,
  RefreshCw,
  Search as SearchIcon,
} from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import {
  exportLedger,
  mergeLedger,
  queryHistory,
  queryStats,
  type HistoryCursor,
} from "./ledger-db";
import {
  listeningDuration,
  localDate,
  parseLedger,
  type LedgerEntry,
  type LedgerStats,
  type SongStats,
} from "./ledger";
interface Props {
  onClose: () => void;
  checkpoint: () => Promise<void>;
  recordingError: string;
}
const timestamp = (time: number) =>
  new Date(time).toLocaleString("zh-CN", { hour12: false });
function initialFrom() {
  const date = new Date();
  date.setDate(date.getDate() - 6);
  return localDate(date.getTime());
}
export function Statistics({ onClose, checkpoint, recordingError }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const importer = useRef<HTMLInputElement>(null);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(() => localDate(Date.now()));
  const [period, setPeriod] = useState("7");
  const [song, setSong] = useState<SongStats>();
  const [tab, setTab] = useState<"songs" | "days" | "history">("songs");
  const [stats, setStats] = useState<LedgerStats>();
  const [history, setHistory] = useState<LedgerEntry[]>([]);
  const [next, setNext] = useState<HistoryCursor>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState("");
  const [songLimit, setSongLimit] = useState(50);
  const start = period === "all" ? 0 : new Date(`${from}T00:00:00`).getTime();
  const endDate = new Date(`${to}T00:00:00`);
  endDate.setDate(endDate.getDate() + 1);
  const end = endDate.getTime();
  const valid = Number.isFinite(start) && Number.isFinite(end) && start < end;
  const checkpointRef = useRef(checkpoint);
  checkpointRef.current = checkpoint;
  const generation = useRef(0);
  const browsingHistory = useRef(false);
  const lastScope = useRef("");
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  useEffect(() => {
    // Only recalculate when visible and changed; never scan historical rows on each heartbeat.
    let dirty = false;
    const changed = () => {
      dirty = true;
    };
    const timer = window.setInterval(() => {
      if (dirty) {
        dirty = false;
        setRevision((n) => n + 1);
      }
    }, 5000);
    window.addEventListener("lori-ledger-change", changed);
    return () => {
      clearInterval(timer);
      window.removeEventListener("lori-ledger-change", changed);
    };
  }, []);
  useEffect(() => {
    const version = ++generation.current;
    const scope = JSON.stringify([start, end, song?.md5]);
    if (lastScope.current !== scope) {
      lastScope.current = scope;
      browsingHistory.current = false;
      setSongLimit(50);
    }
    if (!valid) {
      setError("请选择有效的起止日期");
      return;
    }
    setLoading(true);
    void (async () => {
      await checkpointRef.current();
      const [summary, recent] = await Promise.all([
        queryStats(start, end, song?.md5),
        browsingHistory.current
          ? Promise.resolve(undefined)
          : queryHistory(start, end, song?.md5),
      ]);
      if (version !== generation.current) return;
      setStats(summary);
      if (recent && !browsingHistory.current) {
        setHistory(recent.rows);
        setNext(recent.next);
      }
      setError("");
    })()
      .catch((e) => {
        if (version === generation.current) setError(String(e));
      })
      .finally(() => {
        if (version === generation.current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [start, end, song?.md5, revision, valid]);
  function choosePeriod(value: string) {
    setPeriod(value);
    setTo(localDate(Date.now()));
    if (value !== "all") {
      const date = new Date();
      date.setDate(date.getDate() - Number(value) + 1);
      setFrom(localDate(date.getTime()));
    }
  }
  async function doExport() {
    setBusy(true);
    setMessage("");
    try {
      await checkpointRef.current();
      const blob = await exportLedger();
      const name = `lori-listening-${localDate(Date.now())}.json`;
      if (isTauri()) {
        const path = await save({
          defaultPath: name,
          filters: [{ name: "Lori 听歌账本", extensions: ["json"] }],
        });
        if (!path) return;
        await invoke("save_ledger_export", {
          path,
          contents: await blob.text(),
        });
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      setMessage("已导出完整账本，包含所有日期和歌曲。");
    } catch (e) {
      setMessage(`导出失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  }
  async function doImport(file: File) {
    setBusy(true);
    setMessage("");
    try {
      const entries = parseLedger(await file.text());
      await checkpointRef.current();
      const result = await mergeLedger(entries);
      setMessage(
        `合并完成：新增 ${result.added} 段，更新 ${result.updated} 段，跳过 ${result.unchanged} 段重复记录。`,
      );
      browsingHistory.current = false;
      setRevision((n) => n + 1);
    } catch (e) {
      setMessage(`导入失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  }
  async function moreHistory() {
    if (!next) return;
    browsingHistory.current = true;
    const version = generation.current;
    setBusy(true);
    try {
      const result = await queryHistory(start, end, song?.md5, next);
      if (version !== generation.current) return;
      setHistory((rows) => [...rows, ...result.rows]);
      setNext(result.next);
    } catch (e) {
      setMessage(`读取失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  }
  const songs =
    stats?.songs.filter((s) =>
      `${s.title} ${s.artist} ${s.fileNames.join(" ")} ${s.md5}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) ?? [];
  const peak = Math.max(1, ...(stats?.days.map((d) => d.milliseconds) ?? []));
  return (
    <dialog
      ref={dialog}
      className="statistics"
      aria-labelledby="statistics-title"
      onCancel={onClose}
    >
      <header className="statistics-header">
        <div className="statistics-brand">
          <span className="mini-brand-tag">
            <BarChart3 size={14} /> LORI
          </span>
          <h2 id="statistics-title">
            听歌统计
          </h2>
        </div>
        <div className="statistics-header-actions">
          <button
            className="icon-button"
            title="刷新统计"
            disabled={loading || busy}
            onClick={() => {
              browsingHistory.current = false;
              setRevision((n) => n + 1);
            }}
          >
            <RefreshCw size={14} className={loading ? "spin" : ""} />
          </button>
          <button className="icon-button" title="关闭听歌统计" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </header>
      <div className="statistics-scroll">
        <p className="statistics-intro">
          把听过的时间，留在这里。仅计算实际播放，暂停与跳转不计入。
        </p>
        <div className="statistics-periods" aria-label="统计时间范围">
          {[
            ["1", "今天"],
            ["7", "近 7 天"],
            ["30", "近 30 天"],
            ["all", "全部"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={period === value ? "active" : ""}
              onClick={() => choosePeriod(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="statistics-dates">
          <label className="statistics-date-field">
            <Calendar size={13} />
            <span>从</span>
            <input
              aria-label="统计开始日期"
              type="date"
              value={period === "all" ? "" : from}
              onChange={(e) => {
                setPeriod("custom");
                setFrom(e.target.value);
              }}
            />
          </label>
          <label className="statistics-date-field">
            <span>至</span>
            <input
              aria-label="统计结束日期"
              type="date"
              value={to}
              onChange={(e) => {
                setPeriod("custom");
                if (period === "all") setFrom(initialFrom());
                setTo(e.target.value);
              }}
            />
          </label>
          <span className="statistics-live">
            <span className={`live-dot ${loading ? "live-pulsing" : ""}`} />
            {loading ? "正在演算…" : "播放中每 5 秒更新"}
          </span>
        </div>
        {song && (
          <div className="statistics-song">
            <button onClick={() => setSong(undefined)}>
              <ArrowLeft size={15} /> 全部歌曲
            </button>
            <strong>{song.title}</strong>
            <span>{song.artist}</span>
            <code>{song.md5}</code>
            <small>{song.fileNames.join(" / ")}</small>
          </div>
        )}
        {(error || recordingError) && (
          <p className="statistics-error" role="alert">
            {error || recordingError}
          </p>
        )}
        {valid && stats && (
          <>
            <div className="statistics-metrics">
              <div className="statistics-metric-card primary">
                <div className="metric-header">
                  <Clock size={14} />
                  <span>聆听总时长</span>
                </div>
                <strong data-testid="listening-total">
                  {listeningDuration(stats.milliseconds)}
                </strong>
                <small>精准时间段求并 · 排除暂停与重叠</small>
              </div>
              <div className="statistics-metric-card">
                <div className="metric-header">
                  <Music2 size={14} />
                  <span>聆听歌曲数</span>
                </div>
                <strong>
                  {stats.songs.length}
                  <small> 首</small>
                </strong>
                <small>按原音频 MD5 标识 · 改名不重复计</small>
              </div>
              <div className="statistics-metric-card">
                <div className="metric-header">
                  <Calendar size={14} />
                  <span>音乐相伴日数</span>
                </div>
                <strong>
                  {stats.days.length}
                  <small> 天</small>
                </strong>
                <small>按本地自然日划分统计</small>
              </div>
            </div>
            <div
              className="statistics-tabs"
              role="tablist"
              aria-label="统计视图"
            >
              {(
                [
                  ["songs", "歌曲排行"],
                  ["days", "每日时长"],
                  ["history", "时间段账本"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            {!stats.entries ? (
              <div className="statistics-empty">
                <BarChart3 size={30} />
                <h3>这段时间，还没有听歌记录</h3>
                <p>播放一首音乐后会自动记录，也可以导入已有账本。</p>
              </div>
            ) : (
              <div className="statistics-panel" role="tabpanel">
                {tab === "songs" && (
                  <>
                    <div className="search statistics-search-box">
                      <SearchIcon size={14} />
                      <input
                        className="statistics-search"
                        aria-label="搜索统计歌曲"
                        placeholder="搜索歌曲、文件名或 MD5"
                        value={search}
                        onChange={(e) => {
                          setSearch(e.target.value);
                          setSongLimit(50);
                        }}
                      />
                      {search && (
                        <button title="清空搜索" onClick={() => setSearch("")}>
                          <X size={13} />
                        </button>
                      )}
                    </div>
                    <div className="statistics-ranking">
                      {songs.slice(0, songLimit).map((item, index) => (
                        <button
                          key={item.md5}
                          onClick={() => {
                            setSong(item);
                            setTab("history");
                          }}
                          title={`查看时间段 · ${item.fileNames.join(" / ")} · ${item.md5}`}
                        >
                          <span className="statistics-rank">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span className="statistics-track">
                            <strong>{item.title || item.fileNames[0]}</strong>
                            <small>
                              {item.artist} · {item.fileNames.join(" / ")}
                            </small>
                            <i
                              style={{
                                width: `${Math.max(1, (item.milliseconds / (songs[0]?.milliseconds || 1)) * 100)}%`,
                              }}
                            />
                          </span>
                          <span className="statistics-duration">
                            {listeningDuration(item.milliseconds)}
                          </span>
                        </button>
                      ))}
                    </div>
                    {!songs.length && (
                      <p className="statistics-note">没有找到这首歌。</p>
                    )}
                    {songs.length > songLimit && (
                      <button
                        className="statistics-more"
                        onClick={() => setSongLimit((n) => n + 50)}
                      >
                        显示更多歌曲
                      </button>
                    )}
                    <p className="statistics-note">
                      点击歌曲查看文件 MD5
                      与时间段。同一文件改名仍归为同一首歌。多设备同时播放不同歌曲时，各歌曲时长之和可能大于总时长。
                    </p>
                  </>
                )}
                {tab === "days" && (
                  <div className="statistics-days">
                    {[...stats.days]
                      .reverse()
                      .slice(0, 90)
                      .map((day) => (
                        <div key={day.date}>
                          <time>{day.date}</time>
                          <div>
                            <i
                              style={{
                                width: `${Math.max(1, (day.milliseconds / peak) * 100)}%`,
                              }}
                            />
                          </div>
                          <span>{listeningDuration(day.milliseconds)}</span>
                        </div>
                      ))}
                    {stats.days.length > 90 && (
                      <p className="statistics-note">
                        展示最近 90 个有记录的日期，可缩小日期范围查看更早记录。
                      </p>
                    )}
                  </div>
                )}
                {tab === "history" && (
                  <>
                    <p className="statistics-note">
                      每段最长 1
                      分钟，播放中持续保存。以下为原始时间段（本地时间）；汇总按所选日期裁剪并对重叠去重。
                    </p>
                    {history.length > 50 && (
                      <p className="statistics-note">
                        浏览历史时保留当前位置，点击刷新可回到最新记录。
                      </p>
                    )}
                    <div className="statistics-history">
                      {history.map((entry) => (
                        <article key={entry.id}>
                          <div>
                            <strong>{entry.title || entry.fileName}</strong>
                            <span>
                              {listeningDuration(entry.end - entry.start)}
                            </span>
                          </div>
                          <time>
                            {timestamp(entry.start)} → {timestamp(entry.end)}
                          </time>
                          <small>{entry.fileName}</small>
                          <code title="原始歌曲文件 MD5">
                            MD5 {entry.songMd5}
                          </code>
                        </article>
                      ))}
                    </div>
                    {next && (
                      <button
                        className="statistics-more"
                        disabled={busy}
                        onClick={() => void moreHistory()}
                      >
                        加载更早记录
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <footer className="statistics-footer">
        {message && <p role="status">{message}</p>}
        <div>
          <span>账本保存在本机 · 导入自动合并</span>
          <button disabled={busy} onClick={() => importer.current?.click()}>
            <Upload size={14} /> 导入账本
          </button>
          <button disabled={busy} onClick={() => void doExport()}>
            <Download size={14} /> {busy ? "处理中…" : "导出全部"}
          </button>
        </div>
      </footer>
      <input
        ref={importer}
        aria-label="导入统计数据"
        hidden
        type="file"
        accept=".json,application/json"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void doImport(file);
        }}
      />
    </dialog>
  );
}
