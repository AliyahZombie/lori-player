import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.isTauri = true;
    w.shortcutApplies = [];
    w.shortcutListeners = {};
    const callbacks = new Map();
    let sequence = 0;
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback: (callback: any) => { callbacks.set(++sequence, callback); return sequence; },
      unregisterCallback: (id: number) => callbacks.delete(id),
      invoke: async (command: string, args: any) => {
        if (command === "plugin:event|listen") { w.shortcutListeners[args.event] = callbacks.get(args.handler); return args.handler; }
        if (command === "shortcut_backend") return "native";
        if (command === "apply_shortcuts") {
          w.shortcutApplies.push(args.config);
          if (w.failShortcutSave) throw new Error("该快捷键已被占用");
          return { portal: false, triggers: args.config.enabled ? args.config.bindings : {} };
        }
        return undefined;
      },
    };
  });
  await page.goto("/");
});

test("icon toolbar and keyboard settings record, validate, clear, save and restore", async ({ page }) => {
  const statistics = page.getByRole("button", { name: "听歌统计", exact: true });
  await expect(statistics).toHaveText("");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "设置" });
  await expect(dialog).toBeVisible();
  await page.getByRole("switch").click();
  const next = page.getByRole("textbox", { name: "下一曲快捷键", exact: true });
  await next.focus();
  await page.keyboard.press("Control+Alt+ArrowLeft");
  await expect(page.getByRole("alert")).toContainText("相同快捷键");
  await expect(page.getByRole("button", { name: "保存设置" })).toBeDisabled();
  await next.focus();
  await page.keyboard.press("Control+Alt+KeyN");
  await expect(next).toHaveValue("Ctrl + Alt + N");
  await page.getByRole("button", { name: "清除音量减少快捷键" }).click();
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(dialog.getByRole("status")).toHaveText("已保存");
  await page.screenshot({ path: "/tmp/lori-shortcut-settings.png" });
  await page.reload();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  await expect(next).toHaveValue("Ctrl + Alt + N");
  await expect(page.getByRole("textbox", { name: "音量减少快捷键", exact: true })).toHaveValue("");
});

test("registration errors stay visible and failed changes are not saved", async ({ page }) => {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("switch").click();
  await page.evaluate(() => { (window as any).failShortcutSave = true; });
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.getByRole("alert")).toContainText("已被占用");
  expect(await page.evaluate(() => localStorage.getItem("lori-global-shortcuts"))).toBeNull();
  await expect(page.getByRole("button", { name: "保存设置" })).toBeEnabled();
});

test("global actions use the current player volume and are suppressed while editing", async ({ page }) => {
  const send = () => page.evaluate(() => (window as any).shortcutListeners["lori-shortcut"]({ payload: "volumeUp" }));
  await expect.poll(() => page.evaluate(() => typeof (window as any).shortcutListeners["lori-shortcut"])).toBe("function");
  await send();
  await expect.poll(() => page.evaluate(() => document.querySelector("audio")!.volume)).toBe(0.75);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await send();
  expect(await page.evaluate(() => document.querySelector("audio")!.volume)).toBe(0.75);
  await page.getByRole("button", { name: "关闭设置" }).click();
  await send();
  await expect.poll(() => page.evaluate(() => document.querySelector("audio")!.volume)).toBe(0.8);
});
