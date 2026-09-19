import { test, expect } from "@playwright/test";
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
  ).toEqual({ command: "open_lyrics", args: { editable: false } });
  await page.getByRole("button", { name: "调整位置" }).click();
  await expect(page.getByRole("button", { name: "调整位置" })).toHaveClass(
    "active",
  );
  expect(
    await page.evaluate(() => (window as any).overlayCalls.at(-1)),
  ).toEqual({ command: "open_lyrics", args: { editable: true } });
  await page.getByRole("button", { name: "鼠标穿透" }).click();
  await expect(page.getByRole("button", { name: "鼠标穿透" })).toHaveClass(
    "active",
  );
  expect(
    await page.evaluate(() => (window as any).overlayCalls.at(-1)),
  ).toEqual({ command: "open_lyrics", args: { editable: false } });
  await page.getByRole("button", { name: "关闭桌面歌词", exact: true }).click();
  await expect(page.locator(".overlay-menu")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as any).overlayCalls.at(-1).command),
  ).toBe("close_lyrics");
});
