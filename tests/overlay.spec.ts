import { test, expect } from "@playwright/test";
test("transparent lyrics shimmer crisply and slide between lines without stale layers", async ({
  page,
}) => {
  await page.setViewportSize({ width: 760, height: 100 });
  await page.addInitScript(() => {
    let nextId = 0;
    const callbacks = new Map<number, Function>();
    let handler = 0;
    (window as any).__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "lyrics" },
        currentWebview: { label: "lyrics" },
      },
      transformCallback: (callback: Function) => {
        callbacks.set(++nextId, callback);
        return nextId;
      },
      invoke: async (cmd: string, args: any) => {
        if (cmd === "plugin:event|listen") {
          handler = args.handler;
          return 1;
        }
      },
    };
    (window as any).sendLyric = (line: string, playing = true) =>
      callbacks.get(handler)?.({
        payload: {
          line,
          playing,
          hue: 215,
          neon: true,
          title: "Test",
          artist: "",
          next: "",
        },
      });
  });
  await page.goto("/?lyrics=1");
  await expect(page.locator(".floating")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(page.locator(".floating")).toHaveCSS("backdrop-filter", "none");
  await page.mouse.move(800, 150);
  await expect(page.locator(".floating button")).toHaveCount(0);
  await page.evaluate(() => (window as any).sendLyric("燃烧在 黑～夜～里～"));
  await expect(page.locator(".float-incoming .float-text")).toHaveText(
    "燃烧在 黑～夜～里～",
  );
  await expect(page.locator(".float-outgoing")).toHaveCount(0);
  await expect(page.locator(".float-text")).toHaveCSS("text-shadow", "none");
  await expect(page.locator(".float-text")).toHaveCSS(
    "animation-play-state",
    "running",
  );
  await expect(page.locator(".float-text")).toHaveCSS(
    "background-clip",
    "text",
  );
  expect(
    await page
      .locator(".float-text")
      .evaluate((el) => getComputedStyle(el, "::after").content),
  ).toBe("none");
  await page.screenshot({
    path: ".qa/flowing-lyrics.png",
    omitBackground: true,
  });
  await page.evaluate(() => (window as any).sendLyric("下一句从下方滑入"));
  await expect(page.locator(".float-outgoing")).toHaveText(
    "燃烧在 黑～夜～里～",
  );
  await expect(page.locator(".float-incoming")).toHaveCSS(
    "animation-name",
    "lyric-enter",
  );
  await page.evaluate(() =>
    (window as any).sendLyric("快速跳转后的歌词", false),
  );
  await expect(page.locator(".float-incoming")).toHaveText("快速跳转后的歌词");
  await expect(page.locator(".float-outgoing")).toHaveCount(0);
  await expect(page.locator(".float-text")).toHaveCSS(
    "animation-play-state",
    "paused",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".float-text")).toHaveCSS("animation-name", "none");
  await page.mouse.move(350, 50);
  await expect(page.locator(".floating button")).toHaveCount(0);
});
