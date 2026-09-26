import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  defaultShortcuts,
  parseShortcutConfig,
  shortcutStorageKey,
  type ShortcutAction,
  type ShortcutConfig,
  type ShortcutStatus,
} from "./shortcuts";

export function useShortcuts(onAction: (action: ShortcutAction) => void) {
  const [config, setConfig] = useState<ShortcutConfig>(() =>
    structuredClone(defaultShortcuts),
  );
  const [status, setStatus] = useState<ShortcutStatus>({
    portal: false,
    triggers: {},
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const callback = useRef(onAction);
  callback.current = onAction;
  const activeConfig = useRef(config);
  const saving = useRef(false);
  useEffect(() => {
    let disposed = false;
    const offs: (() => void)[] = [];
    void (async () => {
      try {
        if (isTauri()) {
          for (const off of await Promise.all([
            listen<ShortcutAction>("lori-shortcut", (event) =>
              callback.current(event.payload),
            ),
            listen<ShortcutStatus>("lori-shortcuts-changed", (event) =>
              setStatus(event.payload),
            ),
          ])) {
            if (disposed) off();
            else offs.push(off);
          }
          if (disposed) return;
          const backend = await invoke<string>("shortcut_backend");
          setStatus({ portal: backend === "portal", triggers: {} });
        }
        const saved = parseShortcutConfig(
          localStorage.getItem(shortcutStorageKey),
        );
        if (disposed) return;
        activeConfig.current = saved;
        setConfig(saved);
        if (isTauri() && saved.enabled)
          setStatus(
            await invoke<ShortcutStatus>("apply_shortcuts", { config: saved }),
          );
      } catch (error) {
        if (!disposed) setError(`全局快捷键未生效：${String(error)}`);
      } finally {
        if (!disposed) setBusy(false);
      }
    })();
    return () => {
      disposed = true;
      offs.forEach((off) => off());
    };
  }, []);

  async function save(next: ShortcutConfig) {
    if (saving.current) return false;
    saving.current = true;
    setBusy(true);
    setError("");
    const old = activeConfig.current;
    try {
      const result = await invoke<ShortcutStatus>("apply_shortcuts", {
        config: next,
      });
      try {
        localStorage.setItem(shortcutStorageKey, JSON.stringify(next));
      } catch (storageError) {
        // Do not leave unpersisted shortcuts running after reporting a failed save.
        try {
          setStatus(
            await invoke<ShortcutStatus>("apply_shortcuts", { config: old }),
          );
        } catch (rollbackError) {
          throw new Error(
            `保存失败：${String(storageError)}；恢复原快捷键也失败：${String(rollbackError)}`,
          );
        }
        throw storageError;
      }
      activeConfig.current = next;
      setConfig(next);
      setStatus(result);
      return true;
    } catch (error) {
      setError(`快捷键保存失败：${String(error)}`);
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return { config, status, error, busy, save, native: isTauri() };
}
