import { useEffect, useRef, useState, type RefObject } from "react";
import { ListeningRecorder, type SongIdentity } from "./listening-recorder";
import { mergeLedger } from "./ledger-db";
import type { LedgerEntry } from "./ledger";
export function useListeningLedger(audio: RefObject<HTMLAudioElement | null>) {
  const recorder = useRef<ListeningRecorder | undefined>(undefined);
  const pending = useRef(new Map<string, LedgerEntry>());
  const inFlight = useRef<Promise<void> | undefined>(undefined);
  const [error, setError] = useState("");
  function snapshot() {
    const el = audio.current!;
    return {
      wall: Date.now(),
      mono: performance.now(),
      media: el.currentTime,
      rate: el.playbackRate,
    };
  }
  async function flush(): Promise<void> {
    if (inFlight.current) await inFlight.current;
    if (!pending.current.size) return;
    const batch = [...pending.current.values()];
    const work = mergeLedger(batch)
      .then(() => {
        for (const row of batch)
          if (pending.current.get(row.id) === row)
            pending.current.delete(row.id);
        setError("");
      })
      .catch((error: unknown) => {
        setError(`听歌记录尚未保存，将自动重试：${String(error)}`);
        throw error;
      });
    inFlight.current = work;
    try {
      await work;
    } finally {
      if (inFlight.current === work) inFlight.current = undefined;
    }
  }
  const flushRef = useRef(flush);
  flushRef.current = flush;
  const sample = () => {
    if (audio.current) recorder.current?.sample(snapshot());
  };
  const stop = (credit = true) => {
    recorder.current?.stop(credit && audio.current ? snapshot() : undefined);
    void flushRef.current().catch(() => {});
  };
  function setSong(song?: SongIdentity) {
    stop();
    recorder.current = song
      ? new ListeningRecorder(song, (entry) =>
          pending.current.set(entry.id, entry),
        )
      : undefined;
  }
  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const start = () => {
      if (!el.paused && !el.seeking && el.readyState >= 3)
        recorder.current?.start(snapshot());
    };
    const pause = () => stop();
    const seeking = () => stop(false);
    const rate = () => {
      stop(false);
      start();
    };
    const events: [string, EventListener][] = [
      ["playing", start],
      ["pause", pause],
      ["ended", pause],
      ["waiting", pause],
      ["seeking", seeking],
      ["seeked", start],
      ["ratechange", rate],
      ["error", pause],
      ["emptied", seeking],
      ["timeupdate", sample],
    ];
    events.forEach(([name, handler]) => el.addEventListener(name, handler));
    const heartbeat = window.setInterval(() => {
      sample();
      void flushRef.current().catch(() => {});
    }, 1000);
    const hidden = () => {
      sample();
      void flushRef.current().catch(() => {});
    };
    const unload = () => stop();
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", unload);
    return () => {
      stop();
      clearInterval(heartbeat);
      events.forEach(([name, handler]) =>
        el.removeEventListener(name, handler),
      );
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", unload);
    };
  }, []);
  return {
    setSong,
    stop,
    error,
    checkpoint: async () => {
      sample();
      await flush();
    },
  };
}
