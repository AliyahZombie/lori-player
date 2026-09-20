import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Track } from "./library";
const fingerprints = new WeakMap<File, Promise<string>>();
export async function fingerprint(track: Track): Promise<string> {
  if (isTauri() && track.path)
    return invoke<string>("fingerprint_audio", { path: track.path });
  const file = track.file;
  if (!file) throw new Error("无法读取原始歌曲文件");
  const existing = fingerprints.get(file);
  if (existing) return existing;
  const result = new Promise<string>((resolve, reject) => {
    const worker = new Worker(
      new URL("./fingerprint.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (event) => {
      worker.terminate();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.md5);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage(file);
  });
  fingerprints.set(file, result);
  try {
    return await result;
  } catch (error) {
    fingerprints.delete(file);
    throw error;
  }
}
