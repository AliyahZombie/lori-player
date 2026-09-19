import { describe, expect, it } from "vitest";
import {
  activeLine,
  lyricProgress,
  clock,
  mergeTracks,
  parseLrc,
  type Track,
} from "./library";
describe("LRC synchronization", () => {
  it("expands repeated timestamps, sorts lines and applies millisecond offsets", () => {
    expect(
      parseLrc(
        "[ti:Song]\n[offset:-250]\n[00:03.50][00:01.50]再次响起\n[00:00.10]开始",
      ),
    ).toEqual([
      { time: 0, text: "开始" },
      { time: 1.25, text: "再次响起" },
      { time: 3.25, text: "再次响起" },
    ]);
  });
  it("handles the intro, exact boundaries and backward seeking", () => {
    const lines = parseLrc("[00:02.00]第一句\n[00:05.00]第二句");
    expect(activeLine(lines, 0)).toBe(-1);
    expect(activeLine(lines, 5)).toBe(1);
    expect(activeLine(lines, 3)).toBe(0);
  });
  it("ignores metadata and untimed text", () => {
    expect(parseLrc("[ar:Artist]\nplain text")).toEqual([]);
  });
});
it("deduplicates reimports while refreshing metadata", () => {
  const a = { id: "song", title: "old" } as Track;
  const b = { id: "song", title: "new" } as Track;
  expect(mergeTracks([a], [b])).toEqual([b]);
});
it("formats audio time safely", () => {
  expect(clock(125.7)).toBe("2:05");
  expect(clock(Infinity)).toBe("0:00");
});

it("tracks line wipe across seeking, intro and the last line", () => {
  const lines = parseLrc("[00:02]first\n[00:06]last");
  expect(lyricProgress(lines, -1, 0, 10)).toBe(0);
  expect(lyricProgress(lines, 0, 4, 10)).toBe(0.5);
  expect(lyricProgress(lines, 0, 2, 10)).toBe(0);
  expect(lyricProgress(lines, 1, 8, 10)).toBe(0.5);
  expect(lyricProgress(lines, 1, 12, 10)).toBe(1);
});
