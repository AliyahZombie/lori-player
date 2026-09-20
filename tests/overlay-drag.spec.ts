import { test, expect } from "@playwright/test";
test("overlay drag moves native window using screen delta and releases capture", async ({
  page,
}) => {
  await page.setViewportSize({ width: 760, height: 58 });
  await page.addInitScript(() => {
    (window as any).moves = [];
    (window as any).__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "lyrics" },
        currentWebview: { label: "lyrics" },
      },
      transformCallback: () => 1,
      invoke: async (cmd: string, args: any) => {
        if (cmd === "plugin:window|outer_position") return { x: 200, y: 100 };
        if (cmd === "plugin:window|scale_factor") return 1;
        if (cmd === "plugin:window|set_position")
          (window as any).moves.push(JSON.parse(JSON.stringify(args)));
        return cmd === "plugin:event|listen" ? 1 : undefined;
      },
    };
  });
  await page.goto("/?lyrics=1");
  await expect(page.locator(".float-line")).toBeVisible();
  await page.mouse.move(300, 28);
  await page.mouse.down();
  await page.mouse.move(360, 38, { steps: 8 });
  await expect
    .poll(() => page.evaluate(() => (window as any).moves.length))
    .toBeGreaterThan(0);
  await page.mouse.up();
  const moves = await page.evaluate(() => (window as any).moves);
  expect(moves.at(-1).value).toEqual({ Physical: { x: 260, y: 110 } });
  await page.mouse.move(400, 35);
  expect(await page.evaluate(() => (window as any).moves.length)).toBe(
    moves.length,
  );
});
