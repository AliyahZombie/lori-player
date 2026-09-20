import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
function wav(seconds = 20) {
  const samples = 8000 * seconds;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    buffer.writeInt16LE(
      Math.round(Math.sin((i * 2 * Math.PI * 220) / 8000) * 1000),
      44 + i * 2,
    );
  return buffer;
}
const today = new Date();
today.setHours(0, 0, 0, 0);
const base = today.getTime() + 120_000;
const row = (
  id: string,
  start: number,
  end: number,
  md5 = "a".repeat(32),
  fileName = "月光.wav",
) => ({
  id,
  songMd5: md5,
  fileName,
  title: "月光",
  artist: "Lori",
  start,
  end,
});
const file = (entries: unknown[]) => ({
  name: "ledger.json",
  mimeType: "application/json",
  buffer: Buffer.from(
    JSON.stringify({ format: "lori-listening-ledger", version: 1, entries }),
  ),
});
test("merge, overlap union, conflicts, date clipping, export and persistence", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("添加音乐", { exact: true })).toHaveCount(0);
  await page.getByTitle("导入音乐", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "选择音乐文件", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "选择音乐文件夹", exact: true }),
  ).toBeVisible();
  await page.getByTitle("听歌统计", { exact: true }).click();
  await expect(page.getByText("这段时间，还没有听歌记录")).toBeVisible();
  const entries = [
    row("first", base, base + 60000),
    row("second", base + 30000, base + 90000, "a".repeat(32), "改名.wav"),
    row("third", base + 90000, base + 120000, "b".repeat(32)),
  ];
  await page.getByLabel("导入统计数据").setInputFiles(file(entries));
  await expect(page.getByRole("status")).toContainText("新增 3 段");
  await expect(page.getByTestId("listening-total")).toHaveText("0小时 2分 0秒");
  await expect(page.locator(".statistics-ranking > button")).toHaveCount(2);
  await page.getByLabel("导入统计数据").setInputFiles(file(entries));
  await expect(page.getByRole("status")).toContainText("跳过 3 段重复记录");
  await expect(page.getByTestId("listening-total")).toHaveText("0小时 2分 0秒");
  await page
    .getByLabel("导入统计数据")
    .setInputFiles(
      file([
        row("new", base + 180000, base + 190000),
        { ...entries[0], songMd5: "c".repeat(32) },
      ]),
    );
  await expect(page.getByRole("status")).toContainText("冲突");
  await page.getByTitle("刷新统计").click();
  await expect(page.getByTestId("listening-total")).toHaveText("0小时 2分 0秒");
  await page.getByRole("tab", { name: "时间段账本" }).click();
  await expect(page.locator(".statistics-history article")).toHaveCount(3);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出全部" }).click();
  const exported = JSON.parse(
    await readFile(await (await download).path(), "utf8"),
  );
  expect(exported.entries).toHaveLength(3);
  await page.screenshot({ path: ".qa/statistics-ledger.png" });
  await page.reload();
  await page.getByTitle("听歌统计", { exact: true }).click();
  await expect(page.getByTestId("listening-total")).toHaveText("0小时 2分 0秒");
  await page.getByRole("tab", { name: "每日时长" }).click();
  await expect(page.locator(".statistics-days > div")).toHaveCount(1);
  await page.getByRole("tab", { name: "歌曲排行" }).click();
  await page.locator(".statistics-ranking > button").first().click();
  await expect(page.locator(".statistics-song code")).toHaveText(
    "a".repeat(32),
  );
  await expect(page.getByTestId("listening-total")).toHaveText(
    "0小时 1分 30秒",
  );
  await expect(page.locator(".statistics-history article")).toHaveCount(2);
  await page.getByRole("button", { name: "全部歌曲" }).click();
  await page.getByRole("tab", { name: "歌曲排行" }).click();
  await page.screenshot({ path: ".qa/statistics-overview.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("real playback hashes original bytes, excludes seek/pause and combines renamed files", async ({
  page,
}) => {
  const bytes = wav();
  const expectedMd5 = createHash("md5").update(bytes).digest("hex");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByTitle("导入音乐", { exact: true })).toBeEnabled();
  await page.locator('input[accept="audio/*,.lrc"]').setInputFiles([
    { name: "原名.wav", mimeType: "audio/wav", buffer: bytes },
    { name: "改名.wav", mimeType: "audio/wav", buffer: bytes },
  ]);
  await expect(page.locator(".song")).toHaveCount(2);
  await page.evaluate(() => {
    document.querySelector("audio")!.muted = true;
  });
  await page.locator(".song-main").first().click();
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector("audio")!.currentTime),
    )
    .toBeGreaterThan(2);
  await page.getByLabel("播放进度").fill("15");
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector("audio")!.currentTime),
    )
    .toBeGreaterThan(16);
  await page.getByTitle("暂停", { exact: true }).click();
  await page.getByTitle("听歌统计", { exact: true }).click();
  await expect(page.locator(".statistics-ranking > button")).toHaveCount(1);
  await page.locator(".statistics-ranking > button").click();
  await expect(page.locator(".statistics-song code")).toHaveText(expectedMd5);
  const readTotal = () =>
    page.evaluate(async () => {
      const db = await import("/src/ledger-db.ts");
      return (await db.queryStats(0, Date.now() + 1000)).milliseconds;
    });
  const paused = await readTotal();
  expect(paused).toBeGreaterThan(2800);
  expect(paused).toBeLessThan(6000);
  await page.waitForTimeout(1500);
  expect(await readTotal()).toBe(paused);
  await page.getByTitle("关闭听歌统计").click();
  await page.locator(".song-main").nth(1).click();
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector("audio")!.currentTime),
    )
    .toBeGreaterThan(1.5);
  await page.getByTitle("暂停", { exact: true }).click();
  await page.getByTitle("听歌统计", { exact: true }).click();
  await expect(page.locator(".statistics-ranking > button")).toHaveCount(1);
  await expect(page.locator(".statistics-ranking small")).toContainText(
    "原名.wav",
  );
  await expect(page.locator(".statistics-ranking small")).toContainText(
    "改名.wav",
  );
  const beforeReload = await readTotal();
  expect(beforeReload).toBeGreaterThan(paused + 1300);
  await page.reload();
  await expect(page.locator(".song")).toHaveCount(2);
  expect(await readTotal()).toBe(beforeReload);
  await page.getByTitle("从曲库移除，保留原文件").first().click();
  expect(await readTotal()).toBe(beforeReload);
  expect(errors).toEqual([]);
});
test("indexed history pagination and settled-prefix cache invalidation", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { mergeLedger, queryStats, queryHistory } =
      await import("/src/ledger-db.ts");
    const make = (id: string, start: number, end: number) => ({
      id,
      songMd5: "a".repeat(32),
      fileName: "same.wav",
      title: "Same",
      artist: "",
      start,
      end,
    });
    const entries = Array.from({ length: 121 }, (_, i) =>
      make(`id-${String(i).padStart(3, "0")}`, 100000, 101000),
    );
    await mergeLedger(entries);
    const one = await queryStats(0, 200000);
    const two = await queryStats(0, 200000); // fully settled range, empty live tail
    await mergeLedger([make("fresh", 110000, 112000)]);
    const three = await queryStats(0, 200000);
    await mergeLedger([
      make("fresh", 110000, 114000),
      make("fresh", 110000, 113000),
    ]);
    const four = await queryStats(0, 200000);
    const pages: string[] = [];
    let cursor;
    do {
      const result = await queryHistory(0, 200000, undefined, cursor);
      pages.push(...result.rows.map((row: any) => row.id));
      cursor = result.next;
    } while (cursor);
    return {
      totals: [one, two, three, four].map((s) => s.milliseconds),
      ids: pages,
      clipped: (await queryStats(113000, 115000)).milliseconds,
    };
  });
  expect(result.totals).toEqual([1000, 1000, 3000, 5000]);
  expect(result.ids).toHaveLength(122);
  expect(new Set(result.ids).size).toBe(122);
  expect(result.clipped).toBe(1000);
});

test("tray hiding keeps recording; exit commits the final checkpoint and refuses to discard failed writes", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window as any;
    state.isTauri = true;
    state.exitSnapshots = [];
    state.nativeEvents = {};
    let id = 0;
    const callbacks = new Map<number, Function>();
    state.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      transformCallback: (callback: Function) => {
        callbacks.set(++id, callback);
        return id;
      },
      invoke: async (command: string, args: any) => {
        if (command === "plugin:event|listen") {
          state.nativeEvents[args.event] = callbacks.get(args.handler);
          return args.handler;
        }
        if (command === "hide_main") state.wasHidden = true;
        if (command === "quit_app") {
          const { queryStats } = await import("/src/ledger-db.ts");
          const stats = await queryStats(0, Date.now() + 1000);
          state.exitSnapshots.push({
            total: stats.milliseconds,
            paused: document.querySelector("audio")!.paused,
          });
        }
      },
    };
  });
  await page.goto("/");
  await expect(page.getByTitle("导入音乐", { exact: true })).toBeEnabled();
  await page
    .locator('input[accept="audio/*,.lrc"]')
    .setInputFiles({
      name: "后台计时.wav",
      mimeType: "audio/wav",
      buffer: wav(40),
    });
  await expect(page.locator(".song")).toHaveCount(1);
  await page.evaluate(() => {
    document.querySelector("audio")!.muted = true;
  });
  await page.locator(".song-main").click();
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector("audio")!.currentTime),
    )
    .toBeGreaterThan(1);
  await page.getByTitle("关闭窗口（保留后台播放）").click();
  expect(await page.evaluate(() => (window as any).wasHidden)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector("audio")!.currentTime),
    )
    .toBeGreaterThan(2);
  const beforeExit = await page.evaluate(
    () => document.querySelector("audio")!.currentTime * 1000,
  );
  await page.evaluate(() =>
    (window as any).nativeEvents["lori-quit-requested"]({
      event: "lori-quit-requested",
      payload: null,
    }),
  );
  await expect
    .poll(() => page.evaluate(() => (window as any).exitSnapshots.length))
    .toBe(1);
  const saved = await page.evaluate(() => (window as any).exitSnapshots[0]);
  expect(saved.paused).toBe(true);
  expect(saved.total).toBeGreaterThan(beforeExit - 300);
  expect(saved.total).toBeLessThan(beforeExit + 500);

  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    (window as any).restoreWrites = () => {
      IDBDatabase.prototype.transaction = original;
    };
    IDBDatabase.prototype.transaction = function (
      stores: string | string[],
      mode?: IDBTransactionMode,
      options?: IDBTransactionOptions,
    ) {
      if (this.name === "lori-listening-ledger" && mode === "readwrite")
        throw new DOMException("Simulated disk full", "QuotaExceededError");
      return original.call(this, stores, mode, options);
    };
  });
  await page.getByTitle("播放", { exact: true }).click();
  const resumeAt = await page.evaluate(
    () => document.querySelector("audio")!.currentTime,
  );
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector("audio")!.currentTime),
    )
    .toBeGreaterThan(resumeAt + 1);
  await page.evaluate(() =>
    (window as any).nativeEvents["lori-quit-requested"]({
      event: "lori-quit-requested",
      payload: null,
    }),
  );
  await expect(page.getByRole("status")).toContainText("已取消退出");
  expect(await page.evaluate(() => (window as any).exitSnapshots.length)).toBe(
    1,
  );
  await page.evaluate(() => {
    (window as any).restoreWrites();
    (window as any).nativeEvents["lori-quit-requested"]({
      event: "lori-quit-requested",
      payload: null,
    });
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).exitSnapshots.length))
    .toBe(2);
  expect(
    await page.evaluate(() => (window as any).exitSnapshots[1].total),
  ).toBeGreaterThan(saved.total + 900);
});
