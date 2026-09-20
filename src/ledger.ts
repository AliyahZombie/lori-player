/** Version 1: millisecond UTC, half-open intervals, original-file MD5 identity. */
export const MAX_SEGMENT_MS = 60_000;
export interface LedgerEntry {
  id: string;
  songMd5: string;
  fileName: string;
  title: string;
  artist: string;
  start: number;
  end: number;
}
export interface LedgerExport {
  format: "lori-listening-ledger";
  version: 1;
  entries: LedgerEntry[];
}
export function validateEntry(value: unknown): LedgerEntry {
  if (!value || typeof value !== "object")
    throw new Error("账本记录格式不正确");
  const v = value as LedgerEntry;
  if (
    typeof v.id !== "string" ||
    !/^[a-zA-Z0-9-]{1,100}$/.test(v.id) ||
    typeof v.songMd5 !== "string" ||
    !/^[a-f0-9]{32}$/.test(v.songMd5) ||
    ![v.fileName, v.title, v.artist].every(
      (s) => typeof s === "string" && s.length <= 4096,
    ) ||
    !Number.isSafeInteger(v.start) ||
    !Number.isSafeInteger(v.end) ||
    v.start < 0 ||
    v.end <= v.start ||
    v.end > 8_640_000_000_000_000 ||
    v.end - v.start > MAX_SEGMENT_MS
  )
    throw new Error("账本包含无效的歌曲、时间段或记录编号");
  return {
    id: v.id,
    songMd5: v.songMd5,
    fileName: v.fileName,
    title: v.title,
    artist: v.artist,
    start: v.start,
    end: v.end,
  };
}
export function parseLedger(text: string): LedgerEntry[] {
  const value = JSON.parse(text) as LedgerExport;
  if (
    value?.format !== "lori-listening-ledger" ||
    value.version !== 1 ||
    !Array.isArray(value.entries)
  )
    throw new Error("不支持的 Lori 账本格式或版本");
  return value.entries.map(validateEntry);
}
/** Prefix checkpoints can only grow. A conflicting identity is never overwritten. */
export function mergeEntry(
  old: LedgerEntry | undefined,
  incoming: LedgerEntry,
): LedgerEntry {
  if (!old) return incoming;
  if (
    ["id", "songMd5", "fileName", "title", "artist", "start"].some(
      (k) => old[k as keyof LedgerEntry] !== incoming[k as keyof LedgerEntry],
    )
  )
    throw new Error(`记录 ${incoming.id} 存在冲突，未导入任何数据`);
  return old.end >= incoming.end ? old : incoming;
}
export interface SongStats {
  md5: string;
  title: string;
  artist: string;
  fileNames: string[];
  milliseconds: number;
  first: number;
  last: number;
}
export interface LedgerStats {
  milliseconds: number;
  entries: number;
  songs: SongStats[];
  days: { date: string; milliseconds: number }[];
}
export function localDate(time: number) {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
/** Feed in start order: union intervals in O(n), retaining only one end per song. */
export class LedgerAccumulator {
  private end = -Infinity;
  private songEnds = new Map<string, number>();
  private songs = new Map<string, SongStats>();
  private days = new Map<string, number>();
  private milliseconds = 0;
  private entries = 0;
  constructor(
    private from = 0,
    private to = 8_640_000_000_000_000,
  ) {}
  add(entry: LedgerEntry) {
    const start = Math.max(this.from, entry.start),
      end = Math.min(this.to, entry.end);
    if (end <= start) return;
    this.entries++;
    const uniqueStart = Math.max(start, this.end);
    if (end > uniqueStart) {
      this.milliseconds += end - uniqueStart;
      let cursor = uniqueStart;
      while (cursor < end) {
        const date = localDate(cursor);
        const next = new Date(cursor);
        next.setHours(24, 0, 0, 0);
        const boundary = Math.min(end, next.getTime());
        this.days.set(date, (this.days.get(date) ?? 0) + boundary - cursor);
        cursor = boundary;
      }
    }
    this.end = Math.max(this.end, end);
    const songEnd = this.songEnds.get(entry.songMd5) ?? -Infinity;
    const song = this.songs.get(entry.songMd5) ?? {
      md5: entry.songMd5,
      title: entry.title,
      artist: entry.artist,
      fileNames: [],
      milliseconds: 0,
      first: start,
      last: end,
    };
    if (!song.fileNames.includes(entry.fileName))
      song.fileNames.push(entry.fileName);
    song.milliseconds += Math.max(0, end - Math.max(start, songEnd));
    song.last = Math.max(song.last, end);
    this.songEnds.set(entry.songMd5, Math.max(songEnd, end));
    this.songs.set(entry.songMd5, song);
  }
  clone() {
    const copy = new LedgerAccumulator(this.from, this.to);
    copy.end = this.end;
    copy.songEnds = new Map(this.songEnds);
    copy.songs = new Map(
      [...this.songs].map(([id, song]) => [
        id,
        { ...song, fileNames: [...song.fileNames] },
      ]),
    );
    copy.days = new Map(this.days);
    copy.milliseconds = this.milliseconds;
    copy.entries = this.entries;
    return copy;
  }
  result(): LedgerStats {
    return {
      milliseconds: this.milliseconds,
      entries: this.entries,
      songs: [...this.songs.values()].sort(
        (a, b) => b.milliseconds - a.milliseconds || a.md5.localeCompare(b.md5),
      ),
      days: [...this.days].map(([date, milliseconds]) => ({
        date,
        milliseconds,
      })),
    };
  }
}
export function listeningDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 3600)}小时 ${Math.floor(seconds / 60) % 60}分 ${seconds % 60}秒`;
}
