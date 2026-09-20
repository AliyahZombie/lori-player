import { MAX_SEGMENT_MS, type LedgerEntry } from "./ledger";
export type SongIdentity = Pick<
  LedgerEntry,
  "songMd5" | "fileName" | "title" | "artist"
>;
export interface PlaybackSample {
  wall: number;
  mono: number;
  media: number;
  rate: number;
}
/** Actual advancing playback, measured with a monotonic clock and media evidence.
 * Each minute is a grow-only prefix checkpoint; the same id survives every save.
 */
export class ListeningRecorder {
  private active?: {
    base: PlaybackSample;
    last: PlaybackSample;
    saved: number;
    entry?: LedgerEntry;
  };
  constructor(
    private song: SongIdentity,
    private write: (entry: LedgerEntry) => void,
    private uuid: () => string = () => crypto.randomUUID(),
  ) {}
  start(sample: PlaybackSample) {
    if (!this.active && sample.rate > 0)
      this.active = { base: sample, last: sample, saved: 0 };
  }
  sample(now: PlaybackSample) {
    const active = this.active;
    if (!active) return;
    const elapsed = now.mono - active.last.mono;
    // Never turn machine sleep, clock corrections or an unobserved seek into listening.
    if (
      elapsed < 0 ||
      elapsed > 5000 ||
      Math.abs(now.wall - active.last.wall - elapsed) > 1500 ||
      now.media < active.last.media ||
      now.rate !== active.base.rate ||
      (now.media - active.last.media) * 1000 > elapsed * now.rate + 750
    ) {
      this.active = undefined;
      this.start(now);
      return;
    }
    const duration = Math.max(
      0,
      Math.floor(
        Math.min(
          now.mono - active.base.mono,
          ((now.media - active.base.media) * 1000) / active.base.rate,
        ),
      ),
    );
    let saved = active.saved;
    while (saved < duration) {
      const offset = Math.floor(saved / MAX_SEGMENT_MS) * MAX_SEGMENT_MS;
      if (!active.entry || active.entry.start !== active.base.wall + offset) {
        active.entry = {
          ...this.song,
          id: this.uuid(),
          start: active.base.wall + offset,
          end: active.base.wall + offset,
        };
      }
      const end = Math.min(duration, offset + MAX_SEGMENT_MS);
      active.entry = { ...active.entry, end: active.base.wall + end };
      this.write(active.entry);
      saved = end;
    }
    active.saved = duration;
    active.last = now;
    // A delayed waiting event must not bridge a long buffering gap on resumption.
    if (now.mono - active.base.mono - duration > 1500) {
      this.active = undefined;
      this.start(now);
    }
  }
  stop(now?: PlaybackSample) {
    if (now) this.sample(now);
    this.active = undefined;
  }
}
