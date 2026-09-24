import { expect, test } from "@playwright/test";
import path from "node:path";
const samples = process.env.LORI_SAMPLE_DIR;
test("real local import, playback, seeking, lyrics, theming and persistence", async ({
  page,
}) => {
  test.skip(!samples, "Set LORI_SAMPLE_DIR to the supplied music samples");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByTitle("导入音乐", { exact: true })).toBeEnabled();
  await page
    .locator('input[type=file][accept="audio/*,.lrc"]')
    .setInputFiles(
      ["三拜红尘凉.m4a", "三拜红尘凉.lrc", "不眠之夜.m4a", "不眠之夜.lrc"].map(
        (f) => path.join(samples!, f),
      ),
    );
  await expect(page.locator(".song")).toHaveCount(2);
  await page.evaluate(() => {
    document.querySelector("audio")!.muted = true;
  });
  await page.locator(".song-main").first().click();
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector("audio")!.currentTime),
    )
    .toBeGreaterThan(0.2);
  await expect(page.locator(".big-cover img")).toBeVisible();
  await page.getByTitle("显示 / 隐藏歌词").click();
  await expect(page.locator(".lyrics button").first()).toBeVisible();
  await page.evaluate(() => {
    const audio = document.querySelector("audio")!;
    audio.currentTime = 45;
  });
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector("audio")!.currentTime),
    )
    .toBeGreaterThan(44);
  await expect(page.locator(".lyric-active")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const active = document
          .querySelector(".lyric-active")!
          .getBoundingClientRect();
        const canvas = document
          .querySelector(".lyrics")!
          .getBoundingClientRect();
        return Math.abs(
          active.y + active.height / 2 - (canvas.y + canvas.height / 2),
        );
      }),
    )
    .toBeLessThan(35);
  await page.getByTitle("暂停", { exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.querySelector("audio")!.paused))
    .toBe(true);
  await page.getByTitle("喜欢这首歌", { exact: true }).click();
  await page.getByTitle("只看喜欢的音乐").click();
  await expect(page.locator(".song")).toHaveCount(1);
  await page.getByTitle("显示全部音乐").click();
  await page.getByTitle("主题与取色").click();
  await page.getByRole("button", { name: "跟随封面" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number(document.documentElement.style.getPropertyValue("--theme-hue")),
      ),
    )
    .not.toBe(215);
  await page.getByTitle("关闭主题设置").click();
  await page.screenshot({ path: ".qa/compact-lyrics.png" });
  await page.getByTitle("显示 / 隐藏歌词").click();
  await page.screenshot({ path: ".qa/compact-cover.png" });
  await page.reload();
  await expect(page.locator(".song")).toHaveCount(2);
  await page.getByLabel("搜索音乐").fill("不存在的歌");
  await expect(page.locator(".song")).toHaveCount(0);
  await expect(page.getByText("没有找到这首歌")).toBeVisible();
  expect(errors).toEqual([]);
});

test("shows a loading animation while restoring the saved library", async ({
  page,
}) => {
  // Hold the first IndexedDB request open so the restoring state stays
  // observable; the real app resolves it within a few milliseconds.
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB);
    const slow = (request: IDBOpenDBRequest) =>
      new Proxy(request, {
        get(target, property) {
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
        set(target, property, value) {
          if (
            typeof value === "function" &&
            (property === "onsuccess" || property === "onerror")
          )
            return Reflect.set(target, property, (...args: unknown[]) => {
              window.setTimeout(() => (value as () => void)(...args), 900);
            });
          return Reflect.set(target, property, value);
        },
      });
    indexedDB.open = ((...args: [string, number?]) =>
      slow(open(...args))) as typeof indexedDB.open;
  });
  await page.goto("/");
  const loading = page.locator(".playlist-loading");
  await expect(loading).toBeVisible();
  await expect(page.locator(".song-skeleton")).toHaveCount(6);
  await expect(page.locator(".song-skeleton").first()).toHaveCSS(
    "animation-name",
    "skeleton-row-in",
  );
  // The shimmer rides on the pseudo element of every skeleton block.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const cover = document.querySelector(".song-skeleton .skeleton-cover")!;
        return getComputedStyle(cover, "::after").animationName;
      }),
    )
    .toBe("skeleton-shimmer");
  await expect(page.locator(".loading-ring")).toHaveCSS(
    "animation-name",
    "loading-spin",
  );
  await expect(page.getByText("正在读取曲库…")).toBeVisible();
  // The empty-library prompt must not flash while the saved list loads.
  await expect(page.locator(".playlist-empty")).toHaveCount(0);
  await expect(loading).toHaveCount(0);
  await expect(page.getByText("把喜欢的音乐放进来")).toBeVisible();
});
