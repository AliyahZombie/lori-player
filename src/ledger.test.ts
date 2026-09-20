import { describe, expect, it } from "vitest";
import {
  LedgerAccumulator,
  MAX_SEGMENT_MS,
  mergeEntry,
  parseLedger,
  validateEntry,
  type LedgerEntry,
} from "./ledger";
const md5 = "a".repeat(32);
const row = (
  start: number,
  end: number,
  changes: Partial<LedgerEntry> = {},
): LedgerEntry => ({
  id: "record-1",
  songMd5: md5,
  fileName: "song.mp3",
  title: "Song",
  artist: "Artist",
  start,
  end,
  ...changes,
});
function sum(rows: LedgerEntry[], from?: number, to?: number) {
  const accumulator = new LedgerAccumulator(from, to);
  [...rows]
    .sort((a, b) => a.start - b.start)
    .forEach((entry) => accumulator.add(entry));
  return accumulator.result();
}
describe("ledger algebra", () => {
  it("merges checkpoints idempotently, commutatively and associatively", () => {
    const a = row(1000, 2000),
      b = row(1000, 4000),
      c = row(1000, 3000);
    expect(mergeEntry(a, a)).toEqual(a);
    expect(mergeEntry(a, b)).toEqual(mergeEntry(b, a));
    expect(mergeEntry(mergeEntry(a, b), c)).toEqual(
      mergeEntry(a, mergeEntry(b, c)),
    );
    expect(() => mergeEntry(a, row(1001, 2000))).toThrow("冲突");
    expect(() =>
      mergeEntry(a, row(1000, 2000, { songMd5: "b".repeat(32) })),
    ).toThrow("冲突");
  });
  it("unions overlaps across IDs/devices and identifies renamed songs by MD5 only", () => {
    const result = sum([
      row(1000, 10000),
      row(5000, 15000, { id: "other", fileName: "renamed.mp3" }),
      row(14000, 20000, { id: "third", songMd5: "b".repeat(32) }),
    ]);
    expect(result.milliseconds).toBe(19000);
    expect(result.songs).toHaveLength(2);
    expect(result.songs[0].milliseconds).toBe(14000);
    expect(result.songs[0].fileNames).toEqual(["song.mp3", "renamed.mp3"]);
    expect(result.songs[1].milliseconds).toBe(6000);
  });
  it("clips intervals and splits midnight using the local calendar", () => {
    const midnight = new Date(2026, 8, 20).getTime();
    const result = sum(
      [row(midnight - 10000, midnight + 10000)],
      midnight - 5000,
      midnight + 7000,
    );
    expect(result.milliseconds).toBe(12000);
    expect(result.days.map((day) => day.milliseconds)).toEqual([5000, 7000]);
    expect(
      sum([row(midnight - 10000, midnight)], midnight, midnight + 1000)
        .milliseconds,
    ).toBe(0);
  });
  it("clones a settled prefix without mutating the cached aggregates", () => {
    const a = new LedgerAccumulator();
    a.add(row(1000, 2000));
    const b = a.clone();
    b.add(row(2000, 3000, { fileName: "another.mp3" }));
    expect(a.result().milliseconds).toBe(1000);
    expect(a.result().songs[0].fileNames).toEqual(["song.mp3"]);
    expect(b.result().milliseconds).toBe(2000);
  });
  it("rejects malformed imports and unsupported versions", () => {
    const wrap = (entries: unknown[]) =>
      JSON.stringify({ format: "lori-listening-ledger", version: 1, entries });
    expect(parseLedger(wrap([row(1000, 2000)]))).toHaveLength(1);
    for (const invalid of [
      row(1, 1),
      row(0, MAX_SEGMENT_MS + 1),
      row(-1, 1000),
      row(1, 2, { songMd5: "wrong" }),
      { ...row(1, 2), id: undefined },
      { ...row(1, 2), fileName: 42 },
    ])
      expect(() => parseLedger(wrap([invalid]))).toThrow();
    expect(() =>
      parseLedger(
        '{"format":"lori-listening-ledger","version":2,"entries":[]}',
      ),
    ).toThrow();
    expect(() => validateEntry(null)).toThrow();
  });
});
