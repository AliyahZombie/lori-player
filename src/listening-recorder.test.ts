import { describe, expect, it } from "vitest";
import { ListeningRecorder, type PlaybackSample } from "./listening-recorder";
import { mergeEntry, type LedgerEntry } from "./ledger";
function setup() {
  const rows = new Map<string, LedgerEntry>();
  let id = 0;
  const recorder = new ListeningRecorder(
    {
      songMd5: "a".repeat(32),
      fileName: "song.mp3",
      title: "Song",
      artist: "Artist",
    },
    (row) => rows.set(row.id, mergeEntry(rows.get(row.id), row)),
    () => `id-${++id}`,
  );
  const sample = (ms: number, media = ms / 1000, rate = 1): PlaybackSample => ({
    wall: 100000 + ms,
    mono: ms,
    media,
    rate,
  });
  const total = () =>
    [...rows.values()].reduce((sum, row) => sum + row.end - row.start, 0);
  return { rows, recorder, sample, total };
}
describe("actual playback recording", () => {
  it("checkpoints once a second but stores at most one row per minute", () => {
    const { recorder, rows, sample, total } = setup();
    recorder.start(sample(0));
    for (let i = 1; i <= 125; i++) recorder.sample(sample(i * 1000));
    expect(rows.size).toBe(3);
    expect(total()).toBe(125000);
    expect([...rows.values()].map((row) => row.end - row.start)).toEqual([
      60000, 60000, 5000,
    ]);
  });
  it("excludes pause time and buffering", () => {
    const { recorder, sample, total } = setup();
    recorder.start(sample(0));
    recorder.sample(sample(1000));
    recorder.stop(sample(1500, 1.25));
    recorder.sample(sample(4000, 1.25));
    recorder.start(sample(5000, 1.25));
    recorder.sample(sample(6000, 2.25));
    recorder.stop(sample(6500, 2.25));
    expect(total()).toBe(2250);
  });
  it("does not count seeking or machine sleep", () => {
    const { recorder, sample, total } = setup();
    recorder.start(sample(0));
    recorder.sample(sample(1000));
    recorder.sample(sample(2000, 90));
    recorder.sample(sample(3000, 91));
    recorder.sample(sample(100000, 91));
    recorder.sample(sample(101000, 92));
    expect(total()).toBe(3000);
  });
  it("uses real elapsed time for double speed and rejects wall clock jumps", () => {
    const { recorder, sample, total } = setup();
    recorder.start(sample(0, 0, 2));
    recorder.sample(sample(1000, 2, 2));
    recorder.sample({ ...sample(2000, 4, 2), wall: 9999999 });
    expect(total()).toBe(1000);
  });
  it("finishes once and never adds stopped time", () => {
    const { recorder, sample, total } = setup();
    recorder.start(sample(0));
    recorder.stop(sample(750));
    recorder.stop(sample(1000));
    recorder.sample(sample(2000));
    expect(total()).toBe(750);
  });
});
