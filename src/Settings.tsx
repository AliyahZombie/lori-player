import { useEffect, useRef, useState } from "react";
import {
  Keyboard,
  Settings2,
  SkipBack,
  SkipForward,
  Play,
  Volume2,
  Volume1,
  RotateCcw,
  X,
  Check,
} from "lucide-react";
import {
  defaultShortcuts,
  recordShortcut,
  shortcutActions,
  shortcutConflict,
  shortcutLabel,
  type ShortcutAction,
  type ShortcutConfig,
  type ShortcutStatus,
} from "./shortcuts";
const icons = {
  previous: SkipBack,
  next: SkipForward,
  toggle: Play,
  volumeUp: Volume2,
  volumeDown: Volume1,
};
interface Props {
  config: ShortcutConfig;
  status: ShortcutStatus;
  error: string;
  busy: boolean;
  native: boolean;
  save: (config: ShortcutConfig) => Promise<boolean>;
  onClose: () => void;
}
export function Settings({
  config,
  status,
  error,
  busy,
  native,
  save,
  onClose,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(() => structuredClone(config));
  const [recording, setRecording] = useState<ShortcutAction>();
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const conflict = shortcutConflict(draft);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    setDraft(structuredClone(config));
  }, [config]);
  function change(id: ShortcutAction, value: string) {
    setDraft((current) => ({
      ...current,
      bindings: { ...current.bindings, [id]: value },
    }));
    setSaved(false);
    setMessage("");
  }
  return (
    <dialog
      ref={dialog}
      className="statistics settings"
      aria-labelledby="settings-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="statistics-header">
        <div className="statistics-brand">
          <span className="mini-brand-tag">
            <Settings2 size={14} /> LORI
          </span>
          <h2 id="settings-title">设置</h2>
        </div>
        <button
          className="icon-button"
          title="关闭设置"
          aria-label="关闭设置"
          disabled={busy}
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </header>
      <div className="statistics-scroll settings-scroll">
        <div className="settings-heading">
          <div className="settings-symbol">
            <Keyboard size={22} />
          </div>
          <div>
            <h3>全局快捷键</h3>
            <p>不必回到播放器，也能掌控音乐。</p>
          </div>
        </div>
        <div className="settings-enable">
          <div>
            <strong>启用全局快捷键</strong>
            <span>在其他应用中，或隐藏播放器后使用</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={draft.enabled}
            aria-label="启用全局快捷键"
            className={`switch ${draft.enabled ? "on" : ""}`}
            disabled={busy || !native}
            onClick={() => {
              setDraft({ ...draft, enabled: !draft.enabled });
              setSaved(false);
            }}
          >
            <i />
          </button>
        </div>
        <div className="settings-section-label">
          <span>播放控制</span>
          <span>快捷键</span>
        </div>
        <div className="shortcut-list">
          {shortcutActions.map(({ id, label, hint }) => {
            const Icon = icons[id];
            return (
              <div className="shortcut-row" key={id}>
                <Icon size={17} />
                <div className="shortcut-description">
                  <strong>{label}</strong>
                  <small>{hint}</small>
                </div>
                <div className="shortcut-control">
                  <input
                    readOnly
                    aria-label={`${label}快捷键`}
                    className={recording === id ? "recording" : ""}
                    disabled={busy || !native}
                    value={
                      recording === id
                        ? "请按下组合键…"
                        : shortcutLabel(draft.bindings[id])
                    }
                    placeholder="未设置"
                    onFocus={() => {
                      setRecording(id);
                      setMessage("");
                    }}
                    onBlur={() => setRecording(undefined)}
                    onKeyDown={(event) => {
                      if (event.code === "Tab") return;
                      event.preventDefault();
                      event.stopPropagation();
                      if (event.code === "Escape") {
                        event.currentTarget.blur();
                        return;
                      }
                      const key = recordShortcut(event.nativeEvent);
                      if (key) {
                        change(id, key);
                        event.currentTarget.blur();
                      } else if (
                        !["Control", "Alt", "Shift", "Meta"].includes(event.key)
                      )
                        setMessage(
                          "请使用 Ctrl、Alt 或 Win / Super 搭配字母、数字、方向键等按键。",
                        );
                    }}
                  />
                  {status.portal && status.triggers[id] && (
                    <small
                      className="shortcut-actual"
                      title={status.triggers[id]}
                    >
                      已授权：{status.triggers[id]}
                    </small>
                  )}
                </div>
                <button
                  className="icon-button shortcut-clear"
                  title={`清除${label}快捷键`}
                  aria-label={`清除${label}快捷键`}
                  disabled={busy || !native || !draft.bindings[id]}
                  onClick={() => change(id, "")}
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
        <p className="settings-help">
          点击快捷键后按下新的组合键，Esc
          取消录入。修改后点击保存；清空可停用单项。
        </p>
        {!native && (
          <p className="settings-platform">
            请在桌面版 Lori 中设置全局快捷键。
          </p>
        )}
        {native && status.portal && (
          <p className="settings-platform">
            Wayland
            需要桌面授权。保存时可能出现系统确认窗口，请以「已授权」按键为准。
          </p>
        )}
        {(error || conflict || message) && (
          <p className="statistics-error" role="alert">
            {conflict || message || error}
          </p>
        )}
      </div>
      <footer className="settings-footer">
        <button
          disabled={busy || !native}
          onClick={() => {
            setDraft({
              enabled: draft.enabled,
              bindings: { ...defaultShortcuts.bindings },
            });
            setSaved(false);
            setMessage("");
          }}
        >
          <RotateCcw size={13} />
          恢复默认
        </button>
        <span role="status">{busy ? "正在应用…" : saved ? "已保存" : ""}</span>
        <button
          className="settings-save"
          disabled={busy || !native || !!conflict}
          onClick={async () => {
            setRecording(undefined);
            setMessage("");
            setSaved(await save(draft));
          }}
        >
          <Check size={14} />
          保存设置
        </button>
      </footer>
    </dialog>
  );
}
