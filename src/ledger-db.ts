import {
  LedgerAccumulator,
  MAX_SEGMENT_MS,
  mergeEntry,
  validateEntry,
  type LedgerEntry,
  type LedgerExport,
} from "./ledger";
let connection: Promise<IDBDatabase> | undefined;
let revision = 0;
const summaries = new Map<
  string,
  { boundary: number; base: LedgerAccumulator }
>();
// Broadcast invalidation also covers another player tab/window using this database.
const channel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("lori-ledger")
    : undefined;
function invalidate(start: number) {
  revision++;
  for (const [key, cache] of summaries)
    if (start < cache.boundary) summaries.delete(key);
  window.dispatchEvent(new Event("lori-ledger-change"));
}
if (channel) channel.onmessage = (event) => invalidate(Number(event.data) || 0);
export function ledgerDatabase() {
  return (connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("lori-listening-ledger", 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("segments", {
        keyPath: "id",
      });
      store.createIndex("start", "start");
      store.createIndex("songStart", ["songMd5", "start"]);
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        connection = undefined;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      connection = undefined;
      reject(request.error);
    };
    request.onblocked = () => {
      connection = undefined;
      reject(new Error("请关闭其他 Lori 窗口后重试"));
    };
  }));
}
function completed(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("账本事务已取消"));
    tx.onerror = () => {}; // onabort carries the transaction outcome.
  });
}
/** One transaction: invalid/conflicting imports cannot partially modify the database. */
export async function mergeLedger(entries: LedgerEntry[]) {
  entries = entries.map(validateEntry);
  const db = await ledgerDatabase();
  const tx = db.transaction("segments", "readwrite");
  const done = completed(tx);
  const store = tx.objectStore("segments");
  let added = 0,
    updated = 0,
    failure: unknown;
  let earliest = Infinity;
  // Queue each get only after its predecessor's put, so duplicates inside the
  // same import observe prior values without holding a second full-size map.
  let index = 0;
  const step = () => {
    if (index === entries.length) return;
    const entry = entries[index++];
    const request = store.get(entry.id);
    request.onsuccess = () => {
      try {
        const old = request.result as LedgerEntry | undefined;
        const merged = mergeEntry(old, entry);
        if (merged !== old) {
          store.put(merged);
          earliest = Math.min(earliest, merged.start);
          if (old) updated++;
          else added++;
        }
        step();
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
  };
  step();
  try {
    await done;
  } catch (error) {
    throw failure ?? error;
  }
  if (added || updated) {
    invalidate(earliest);
    channel?.postMessage(earliest);
  }
  return { added, updated, unchanged: entries.length - added - updated };
}
function range(from: number, to: number, md5?: string) {
  return md5
    ? IDBKeyRange.bound(
        [md5, Math.max(0, from - MAX_SEGMENT_MS)],
        [md5, to],
        false,
        true,
      )
    : IDBKeyRange.bound(Math.max(0, from - MAX_SEGMENT_MS), to, false, true);
}
/** Cache only the derived, settled prefix. Live refresh scans the recent tail;
 * any historical import invalidates the relevant prefix. The ledger stays authoritative. */
export async function queryStats(from: number, to: number, md5?: string) {
  const db = await ledgerDatabase();
  const key = JSON.stringify([from, to, md5]);
  const lower = Math.max(0, from - MAX_SEGMENT_MS);
  const boundary = Math.max(lower, Math.min(to, Date.now() - MAX_SEGMENT_MS));
  const cached = summaries.get(key);
  const reusable = cached && cached.boundary <= boundary ? cached : undefined;
  const base = reusable?.base.clone() ?? new LedgerAccumulator(from, to);
  let live: LedgerAccumulator | undefined;
  const currentRevision = revision;
  const min = reusable?.boundary ?? lower;
  if (min >= to) return base.result();
  const tx = db.transaction("segments", "readonly");
  const done = completed(tx);
  const bounds = md5
    ? IDBKeyRange.bound([md5, min], [md5, to], false, true)
    : IDBKeyRange.bound(min, to, false, true);
  const cursor = tx
    .objectStore("segments")
    .index(md5 ? "songStart" : "start")
    .openCursor(bounds);
  cursor.onsuccess = () => {
    if (!cursor.result) return;
    const entry = cursor.result.value as LedgerEntry;
    if (entry.start < boundary) base.add(entry);
    else {
      live ??= base.clone();
      live.add(entry);
    }
    cursor.result.continue();
  };
  await done;
  if (revision === currentRevision) {
    summaries.delete(key);
    summaries.set(key, { boundary, base });
    if (summaries.size > 3) summaries.delete(summaries.keys().next().value!);
  }
  return (live ?? base).result();
}
export interface HistoryCursor {
  start: number;
  id: string;
}
export async function queryHistory(
  from: number,
  to: number,
  md5?: string,
  before?: HistoryCursor,
) {
  const db = await ledgerDatabase();
  const tx = db.transaction("segments", "readonly");
  const done = completed(tx);
  const rows: LedgerEntry[] = [];
  const upper = before ? Math.min(to, before.start + 1) : to;
  const request = tx
    .objectStore("segments")
    .index(md5 ? "songStart" : "start")
    .openCursor(range(from, upper, md5), "prev");
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    const entry = cursor.value as LedgerEntry;
    if (
      entry.end > from &&
      (!before ||
        entry.start < before.start ||
        (entry.start === before.start && entry.id < before.id))
    )
      rows.push(entry);
    if (rows.length < 51) cursor.continue();
  };
  await done;
  const hasMore = rows.length > 50;
  rows.length = Math.min(rows.length, 50);
  const last = rows.at(-1);
  return {
    rows,
    next: hasMore && last ? { start: last.start, id: last.id } : undefined,
  };
}
export async function exportLedger(): Promise<Blob> {
  const db = await ledgerDatabase();
  const tx = db.transaction("segments", "readonly");
  const done = completed(tx);
  const parts: BlobPart[] = [
    '{"format":"lori-listening-ledger","version":1,"entries":[',
  ];
  let batch: string[] = [],
    first = true;
  const cursor = tx.objectStore("segments").openCursor();
  cursor.onsuccess = () => {
    if (!cursor.result) return;
    batch.push(
      (first ? "" : ",") +
        JSON.stringify(cursor.result.value as LedgerExport["entries"][number]),
    );
    first = false;
    if (batch.length === 1000) {
      parts.push(new Blob(batch));
      batch = [];
    }
    cursor.result.continue();
  };
  await done;
  parts.push(...batch, "]}");
  return new Blob(parts, { type: "application/json" });
}
