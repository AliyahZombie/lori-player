import { describe, expect, it } from "vitest";
import {
  adjustedVolume,
  defaultShortcuts,
  parseShortcutConfig,
  recordShortcut,
  shortcutConflict,
  shortcutLabel,
} from "./shortcuts";
const key = (code: string, extra = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  repeat: false,
  isComposing: false,
  ...extra,
});
describe("global shortcut settings", () => {
  it("records physical keys consistently on Windows and Linux", () => {
    expect(recordShortcut(key("KeyP", { ctrlKey: true, altKey: true }))).toBe(
      "Ctrl+Alt+KeyP",
    );
    expect(
      recordShortcut(key("ArrowUp", { metaKey: true, shiftKey: true })),
    ).toBe("Shift+Super+ArrowUp");
    expect(shortcutLabel("Ctrl+Alt+ArrowLeft")).toBe("Ctrl + Alt + ←");
  });
  it("does not capture typing, repeats, composition or modifier-only presses", () => {
    for (const event of [
      key("Space"),
      key("KeyP", { shiftKey: true }),
      key("ControlLeft", { ctrlKey: true }),
      key("KeyP", { ctrlKey: true, repeat: true }),
      key("KeyP", { ctrlKey: true, isComposing: true }),
    ])
      expect(recordShortcut(event)).toBeNull();
  });
  it("detects duplicate bindings even if modifier order differs and allows clearing", () => {
    const config = structuredClone(defaultShortcuts);
    config.bindings.next = "Alt+Ctrl+ArrowLeft";
    expect(shortcutConflict(config)).toContain("下一曲");
    config.bindings.next = "";
    config.bindings.previous = "";
    expect(shortcutConflict(config)).toBe("");
    expect(parseShortcutConfig(JSON.stringify(config))).toEqual(config);
  });
  it("restores saved preferences and rejects corrupted settings without silently resetting them", () => {
    expect(parseShortcutConfig(null)).toEqual(defaultShortcuts);
    expect(
      parseShortcutConfig(
        JSON.stringify({ ...defaultShortcuts, enabled: true }),
      ).enabled,
    ).toBe(true);
    for (const raw of [
      "{",
      "null",
      "{}",
      JSON.stringify({
        ...defaultShortcuts,
        bindings: { ...defaultShortcuts.bindings, toggle: "Space" },
      }),
    ])
      expect(() => parseShortcutConfig(raw)).toThrow();
  });
  it("changes player volume in exact 5% steps without exceeding audio limits", () => {
    expect(adjustedVolume(0.7, 1)).toBe(0.75);
    expect(adjustedVolume(0.7, -1)).toBe(0.65);
    expect(adjustedVolume(0.98, 1)).toBe(1);
    expect(adjustedVolume(0.02, -1)).toBe(0);
  });
});
