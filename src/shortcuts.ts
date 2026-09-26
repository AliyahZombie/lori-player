export const shortcutActions = [
  { id: "previous", label: "上一曲", hint: "回到上一首音乐" },
  { id: "next", label: "下一曲", hint: "继续下一首音乐" },
  { id: "toggle", label: "播放 / 暂停", hint: "随时停下，随时继续" },
  { id: "volumeUp", label: "音量增加", hint: "播放器音量 +5%" },
  { id: "volumeDown", label: "音量减少", hint: "播放器音量 −5%" },
] as const;
export type ShortcutAction = (typeof shortcutActions)[number]["id"];
export type ShortcutConfig = {
  enabled: boolean;
  bindings: Record<ShortcutAction, string>;
};
export type ShortcutStatus = {
  portal: boolean;
  triggers: Partial<Record<ShortcutAction, string>>;
};
export const shortcutStorageKey = "lori-global-shortcuts";
export const defaultShortcuts: ShortcutConfig = {
  enabled: false,
  bindings: {
    previous: "Ctrl+Alt+ArrowLeft",
    next: "Ctrl+Alt+ArrowRight",
    toggle: "Ctrl+Alt+Space",
    volumeUp: "Ctrl+Alt+ArrowUp",
    volumeDown: "Ctrl+Alt+ArrowDown",
  },
};

const allowedKey =
  /^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-9]|2[0-4])|Arrow(Left|Right|Up|Down)|Space|Home|End|PageUp|PageDown|Insert|Delete|Backspace|Enter)$/;
export function validShortcut(value: string) {
  if (!value) return true;
  const parts = value.split("+");
  const key = parts.pop()!;
  return (
    allowedKey.test(key) &&
    parts.length > 0 &&
    parts.some((p) => p !== "Shift") &&
    parts.every((p) => ["Ctrl", "Alt", "Shift", "Super"].includes(p)) &&
    new Set(parts).size === parts.length
  );
}
export function parseShortcutConfig(raw: string | null): ShortcutConfig {
  if (!raw) return structuredClone(defaultShortcuts);
  const value = JSON.parse(raw);
  if (
    typeof value?.enabled !== "boolean" ||
    !value.bindings ||
    shortcutActions.some(
      ({ id }) =>
        typeof value.bindings[id] !== "string" ||
        !validShortcut(value.bindings[id]),
    )
  ) {
    throw new Error("已保存的快捷键格式无效，请在设置中重新保存。");
  }
  if (shortcutConflict(value))
    throw new Error("已保存的快捷键存在重复，请在设置中重新保存。");
  return {
    enabled: value.enabled,
    bindings: Object.fromEntries(
      shortcutActions.map(({ id }) => [id, value.bindings[id]]),
    ) as ShortcutConfig["bindings"],
  };
}
export function shortcutConflict(config: ShortcutConfig) {
  const seen = new Set<string>();
  for (const { id, label } of shortcutActions) {
    const key = config.bindings[id];
    if (!key) continue;
    const canonical = key.split("+").sort().join("+");
    if (seen.has(canonical))
      return `${label}与其他操作使用了相同快捷键，请更换组合。`;
    seen.add(canonical);
  }
  return "";
}
export function recordShortcut(
  event: Pick<
    KeyboardEvent,
    | "code"
    | "ctrlKey"
    | "altKey"
    | "shiftKey"
    | "metaKey"
    | "repeat"
    | "isComposing"
  >,
): string | null {
  if (event.repeat || event.isComposing || !allowedKey.test(event.code))
    return null;
  if (!event.ctrlKey && !event.altKey && !event.metaKey) return null;
  return [
    event.ctrlKey && "Ctrl",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    event.metaKey && "Super",
    event.code,
  ]
    .filter(Boolean)
    .join("+");
}
export function shortcutLabel(value: string) {
  return value
    .split("+")
    .map(
      (key) =>
        ({
          ArrowLeft: "←",
          ArrowRight: "→",
          ArrowUp: "↑",
          ArrowDown: "↓",
          Space: "空格",
          Super: "Win / Super",
        })[key] ?? key.replace(/^(Key|Digit)/, ""),
    )
    .join(" + ");
}
export function adjustedVolume(current: number, direction: number) {
  return Math.max(
    0,
    Math.min(1, Math.round((current + direction * 0.05) * 100) / 100),
  );
}
