import { test, expect } from "@playwright/test";
test("clicking inactive main requests focus and opening lyrics returns keyboard focus", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).isTauri = true;
    (window as any).focusRequests = 0;
    Object.defineProperty(document, "hasFocus", { value: () => false });
    (window as any).__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      transformCallback: () => 1,
      invoke: async (cmd: string) => {
        if (cmd === "focus_main") (window as any).focusRequests++;
        return cmd === "plugin:event|listen" ? 1 : undefined;
      },
    };
  });
  await page.goto("/");
  await page.getByLabel("搜索音乐").click();
  await expect
    .poll(() => page.evaluate(() => (window as any).focusRequests))
    .toBe(1);
  await page.getByLabel("搜索音乐").fill("焦点验证");
  await expect(page.getByLabel("搜索音乐")).toHaveValue("焦点验证");
  await page.getByTitle("桌面悬浮歌词", { exact: true }).click();
  await expect(page.getByRole("button", { name: "调整位置" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).focusRequests))
    .toBe(3);
});
