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
