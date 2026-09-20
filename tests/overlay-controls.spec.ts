import { test, expect } from "@playwright/test";
import path from "node:path";
const samples = process.env.LORI_SAMPLE_DIR;
test("desktop lyrics default to click-through and can be unlocked and closed from the player", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).isTauri = true;
    (window as any).overlayCalls = [];
    (window as any).__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      transformCallback: () => 1,
      invoke: async (command: string, args: unknown) => {
        if (["open_lyrics", "close_lyrics"].includes(command))
          (window as any).overlayCalls.push({ command, args });
        return command === "plugin:event|listen" ? 1 : undefined;
      },
    };
  });
  await page.goto("/");
  await expect(page.locator(".playlist-header h1")).toHaveCSS(
    "user-select",
    "none",
  );
  await expect(page.getByLabel("搜索音乐")).toHaveCSS("user-select", "text");
  await page.getByTitle("桌面悬浮歌词", { exact: true }).click();
  await expect(page.getByRole("button", { name: "鼠标穿透" })).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).overlayCalls.at(-1)),
  ).toEqual({
    command: "open_lyrics",
    args: { editable: false, fontSize: 34, show: false },
  });
  await expect(page.getByRole("status")).toContainText(
    "桌面歌词会在有歌词时自动显示",
  );
  await page.getByRole("button", { name: "调整位置" }).click();
  await expect(page.getByRole("button", { name: "调整位置" })).toHaveClass(
    "active",
  );
  expect(
    await page.evaluate(() => (window as any).overlayCalls.at(-1)),
  ).toEqual({
    command: "open_lyrics",
    args: { editable: true, fontSize: 34, show: false },
  });
  await page.getByLabel("桌面歌词文字大小").fill("48");
  await page.getByLabel("桌面歌词不透明度").fill("0.55");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("lori-lyric-size")))
    .toBe("48");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("lori-lyric-opacity")))
    .toBe("0.55");
  await page.getByRole("button", { name: "恢复默认", exact: true }).click();
  await expect(page.getByLabel("桌面歌词文字大小")).toHaveValue("34");
  await expect(page.getByLabel("桌面歌词不透明度")).toHaveValue("1");
  await page.getByRole("button", { name: "鼠标穿透" }).click();
  await expect(page.getByRole("button", { name: "鼠标穿透" })).toHaveClass(
    "active",
  );
  expect(
    await page.evaluate(() => (window as any).overlayCalls.at(-1)),
  ).toEqual({
    command: "open_lyrics",
    args: { editable: false, fontSize: 34, show: false },
  });
  await page.getByRole("button", { name: "关闭桌面歌词", exact: true }).click();
  await expect(page.locator(".overlay-menu")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as any).overlayCalls.at(-1).command),
  ).toBe("close_lyrics");
});
test("desktop lyrics hide with the lyric and come back for the next lyric", async ({
  page,
}) => {
  test.skip(!samples, "Set LORI_SAMPLE_DIR to the supplied music samples");
  await page.addInitScript(() => {
    (window as any).isTauri = true;
    (window as any).lyricCalls = [];
    (window as any).__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      transformCallback: () => 1,
      invoke: async (command: string, args: unknown) => {
        if (["open_lyrics", "set_lyrics_visible"].includes(command))
          (window as any).lyricCalls.push({ command, args });
        return command === "plugin:event|listen" ? 1 : undefined;
      },
    };
  });
  await page.goto("/");
  await page
    .locator('input[type=file][accept="audio/*,.lrc"]')
    .setInputFiles(
      ["不眠之夜.m4a", "不眠之夜.lrc", "三拜红尘凉.m4a"].map((f) =>
        path.join(samples!, f),
      ),
    );
  await expect(page.locator(".song")).toHaveCount(2);
  const lastVisible = () =>
    page.evaluate(() => {
      const calls = (window as any).lyricCalls.filter(
        (call: any) => call.command === "set_lyrics_visible",
      );
      return calls.length ? calls.at(-1).args.visible : undefined;
    });
  await expect.poll(lastVisible).toBe(false);
  await page.locator(".song-main").first().click();
  await expect(page.locator(".lyric-import")).toContainText("更换歌词");
  await expect.poll(lastVisible).toBe(true);
  await page.getByTitle("桌面悬浮歌词", { exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).lyricCalls.at(-1)))
    .toEqual({
      command: "open_lyrics",
      args: { editable: false, fontSize: 34, show: true },
    });
  await page.locator(".song").nth(1).locator(".song-main").click();
  await expect(page.locator(".lyric-import")).toContainText("添加歌词");
  await expect.poll(lastVisible).toBe(false);
});
