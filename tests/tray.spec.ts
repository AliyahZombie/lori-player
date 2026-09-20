import { expect, test } from "@playwright/test";

test("the window close button hides the player without quitting or pausing audio", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).isTauri = true;
    (window as any).trayCommands = [];
    (window as any).__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      transformCallback: () => 1,
      invoke: async (command: string) => {
        (window as any).trayCommands.push(command);
        return command === "plugin:event|listen" ? 1 : undefined;
      },
    };
  });
  await page.goto("/");
  await page.evaluate(() => {
    (window as any).pauseCalls = 0;
    document.querySelector("audio")!.pause = () => {
      (window as any).pauseCalls++;
    };
  });
  await page.getByTitle("关闭窗口（保留后台播放）").click();
  const result = await page.evaluate(() => ({
    calls: (window as any).trayCommands,
    pauses: (window as any).pauseCalls,
  }));
  expect(result.calls).toContain("hide_main");
  expect(result.calls).not.toContain("quit_app");
  expect(result.pauses).toBe(0);
});
