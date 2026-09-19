export interface Track {
  id: string;
  path?: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  cover?: string;
  lyrics: string;
  customLyrics?: string;
  format: string;
  folder: string;
  file?: File;
}
export interface Lyric {
  time: number;
  text: string;
}
export function parseLrc(source: string): Lyric[] {
  const result: Lyric[] = [];
  const offset =
    Number(source.match(/\[offset:([+-]?\d+)\]/i)?.[1] ?? 0) / 1000;
  for (const line of source.split(/\r?\n/)) {
    const stamps = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const text = line.replace(/\[[^\]]*\]/g, "").trim();
    for (const stamp of stamps)
      result.push({
        time: Math.max(0, Number(stamp[1]) * 60 + Number(stamp[2]) + offset),
        text,
      });
  }
  return result.sort((a, b) => a.time - b.time);
}
export function activeLine(lines: Lyric[], time: number) {
  let found = -1;
  for (let i = 0; i < lines.length && lines[i].time <= time; i++) found = i;
  return found;
}
export function clock(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}
export function mergeTracks(current: Track[], incoming: Track[]) {
  return [...new Map([...current, ...incoming].map((t) => [t.id, t])).values()];
}

/** LRC timestamps are line-level; this is a proportional line wipe, not word alignment. */
export function lyricProgress(
  lines: Lyric[],
  index: number,
  time: number,
  duration: number,
) {
  if (index < 0 || !lines[index]) return 0;
  const start = lines[index].time;
  const end = lines[index + 1]?.time ?? duration;
  return end > start
    ? Math.max(0, Math.min(1, (time - start) / (end - start)))
    : 0;
}
