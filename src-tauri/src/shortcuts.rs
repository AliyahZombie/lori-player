use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, RwLock,
};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const ACTIONS: [(&str, &str); 5] = [
    ("previous", "上一曲"),
    ("next", "下一曲"),
    ("toggle", "播放 / 暂停"),
    ("volumeUp", "音量增加"),
    ("volumeDown", "音量减少"),
];

#[derive(Clone, Deserialize)]
pub struct Config {
    enabled: bool,
    bindings: HashMap<String, String>,
}

#[derive(Default)]
pub struct Shortcuts {
    update: tokio::sync::Mutex<()>,
    active: Arc<RwLock<HashMap<u32, String>>>,
    native_keys: std::sync::Mutex<Vec<Shortcut>>,
    #[cfg(target_os = "linux")]
    portal: tokio::sync::Mutex<Option<portal::Registration>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    portal: bool,
    triggers: HashMap<String, String>,
}

#[tauri::command]
pub fn shortcut_backend() -> &'static str {
    if uses_portal() {
        "portal"
    } else {
        "native"
    }
}

pub fn uses_portal() -> bool {
    cfg!(target_os = "linux")
        && (std::env::var_os("WAYLAND_DISPLAY").is_some()
            || std::env::var("XDG_SESSION_TYPE").is_ok_and(|v| v == "wayland"))
}

fn validate(config: &Config) -> Result<Vec<(String, String, Shortcut)>, String> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    if config
        .bindings
        .keys()
        .any(|key| !ACTIONS.iter().any(|(id, _)| id == key))
    {
        return Err("未知快捷键操作".into());
    }
    for (action, label) in ACTIONS {
        let value = config
            .bindings
            .get(action)
            .map(String::as_str)
            .unwrap_or("");
        if value.is_empty() {
            continue;
        }
        let shortcut = value
            .parse::<Shortcut>()
            .map_err(|e| format!("{label}：{e}"))?;
        if !seen.insert(shortcut.id()) {
            return Err(format!("{label}与其他操作使用了相同快捷键"));
        }
        result.push((action.into(), value.into(), shortcut));
    }
    Ok(result)
}

#[tauri::command]
pub async fn apply_shortcuts(app: tauri::AppHandle, config: Config) -> Result<Status, String> {
    let mut desired = validate(&config)?;
    if !config.enabled {
        desired.clear();
    }
    let state = app.state::<Shortcuts>();
    let _guard = state.update.lock().await;
    #[cfg(target_os = "linux")]
    if uses_portal() {
        return portal::apply(&app, &state, &desired).await;
    }
    let old = state.active.read().map_err(|e| e.to_string())?.clone();
    let mut added = Vec::new();
    // Reserve new keys first: a conflict never removes the working bindings.
    for (_, text, key) in &desired {
        if old.contains_key(&key.id()) {
            continue;
        }
        let actions = state.active.clone();
        let pressed = Arc::new(AtomicBool::new(false));
        if let Err(error) = app
            .global_shortcut()
            .on_shortcut(*key, move |app, key, event| {
                if event.state == ShortcutState::Released {
                    pressed.store(false, Ordering::SeqCst);
                } else if !pressed.swap(true, Ordering::SeqCst) {
                    if let Ok(actions) = actions.read() {
                        if let Some(action) = actions.get(&key.id()) {
                            let _ = app.emit_to("main", "lori-shortcut", action);
                        }
                    }
                }
            })
        {
            let mut cleanup = Vec::new();
            for key in added {
                if let Err(e) = app.global_shortcut().unregister(key) {
                    cleanup.push(e.to_string());
                }
            }
            return Err(format!(
                "无法注册 {text}，可能已被系统或其他应用占用：{error} {}",
                cleanup.join("；")
            ));
        }
        added.push(*key);
    }
    let next: HashMap<_, _> = desired
        .iter()
        .map(|(action, _, key)| (key.id(), action.clone()))
        .collect();
    // Removing a key only affects our own registrations.
    // Resolve the old IDs via the saved native shortcut objects.
    let removal = {
        let mut keys = state.native_keys.lock().map_err(|e| e.to_string())?;
        let mut errors = Vec::new();
        for key in keys.iter().filter(|key| !next.contains_key(&key.id())) {
            if let Err(error) = app.global_shortcut().unregister(*key) {
                errors.push(error.to_string());
            }
        }
        *keys = desired.iter().map(|(_, _, key)| *key).collect();
        errors
    };
    *state.active.write().map_err(|e| e.to_string())? = next;
    if !removal.is_empty() {
        return Err(format!("快捷键释放失败：{}", removal.join("；")));
    }
    Ok(Status {
        portal: false,
        triggers: desired.into_iter().map(|(a, t, _)| (a, t)).collect(),
    })
}

#[cfg(target_os = "linux")]
mod portal {
    use super::*;
    use ashpd::desktop::{
        global_shortcuts::{GlobalShortcuts, NewShortcut},
        Session,
    };
    use futures_util::StreamExt;

    pub struct Registration {
        session: Session<GlobalShortcuts>,
        activated: tauri::async_runtime::JoinHandle<()>,
        changed: tauri::async_runtime::JoinHandle<()>,
        enabled: Arc<AtomicBool>,
    }

    fn triggers(
        shortcuts: &[ashpd::desktop::global_shortcuts::Shortcut],
    ) -> HashMap<String, String> {
        shortcuts
            .iter()
            .map(|s| {
                (
                    s.id().split("--").next().unwrap_or("").into(),
                    s.trigger_description().into(),
                )
            })
            .collect()
    }

    pub async fn apply(
        app: &tauri::AppHandle,
        state: &Shortcuts,
        desired: &[(String, String, Shortcut)],
    ) -> Result<Status, String> {
        let mut current = state.portal.lock().await;
        if desired.is_empty() {
            if let Some(old) = current.as_ref() {
                old.session.close().await.map_err(|e| e.to_string())?;
            }
            if let Some(old) = current.take() {
                old.enabled.store(false, Ordering::SeqCst);
                old.activated.abort();
                old.changed.abort();
            }
            return Ok(Status {
                portal: true,
                triggers: HashMap::new(),
            });
        }
        let portal = GlobalShortcuts::new()
            .await
            .map_err(|e| format!("桌面未提供全局快捷键接口：{e}"))?;
        let session = portal
            .create_session(Default::default())
            .await
            .map_err(|e| e.to_string())?;
        // Include the preferred key in the stable ID. Desktops may remember a
        // binding by ID; changing a key in Lori must request a new binding.
        let shortcuts: Vec<_> = desired
            .iter()
            .map(|(action, key, _)| {
                let label = ACTIONS.iter().find(|(id, _)| id == action).unwrap().1;
                NewShortcut::new(format!("{action}--{key}"), format!("Lori · {label}"))
                    .preferred_trigger(portal_trigger(key).as_str())
            })
            .collect();
        let prepared = async {
            let activated = portal.receive_activated().await?;
            let changed = portal.receive_shortcuts_changed().await?;
            let response = portal
                .bind_shortcuts(&session, &shortcuts, None, Default::default())
                .await?
                .response()?;
            Ok::<_, ashpd::Error>((activated, changed, triggers(response.shortcuts())))
        }
        .await;
        let (mut activated, mut changed, triggers) = match prepared {
            Ok(value) => value,
            Err(error) => {
                let _ = session.close().await;
                return Err(format!("未启用全局快捷键，桌面授权可能已取消：{error}"));
            }
        };
        if let Some(old) = current.as_ref() {
            if let Err(error) = old.session.close().await {
                let _ = session.close().await;
                return Err(format!("无法释放原快捷键：{error}"));
            }
        }
        if let Some(old) = current.take() {
            old.enabled.store(false, Ordering::SeqCst);
            old.activated.abort();
            old.changed.abort();
        }
        let enabled = Arc::new(AtomicBool::new(true));
        let active = enabled.clone();
        let path = serde_json::to_value(&session)
            .map_err(|e| e.to_string())?
            .as_str()
            .ok_or("无效的桌面会话")?
            .to_owned();
        let handle = app.clone();
        let activated_task = tauri::async_runtime::spawn(async move {
            while let Some(event) = activated.next().await {
                if event.session_handle().as_str() == path && active.load(Ordering::SeqCst) {
                    let action = event.shortcut_id().split("--").next().unwrap_or("");
                    if ACTIONS.iter().any(|(id, _)| *id == action) {
                        let _ = handle.emit_to("main", "lori-shortcut", action);
                    }
                }
            }
        });
        let path = serde_json::to_value(&session)
            .map_err(|e| e.to_string())?
            .as_str()
            .ok_or("无效的桌面会话")?
            .to_owned();
        let handle = app.clone();
        let active = enabled.clone();
        let changed_task = tauri::async_runtime::spawn(async move {
            while let Some(event) = changed.next().await {
                if event.session_handle().as_str() == path && active.load(Ordering::SeqCst) {
                    let _ = handle.emit_to(
                        "main",
                        "lori-shortcuts-changed",
                        super::Status {
                            portal: true,
                            triggers: self::triggers(event.shortcuts()),
                        },
                    );
                }
            }
        });
        *current = Some(Registration {
            session,
            activated: activated_task,
            changed: changed_task,
            enabled,
        });
        Ok(Status {
            portal: true,
            triggers,
        })
    }
}

#[cfg(any(target_os = "linux", test))]
fn portal_trigger(key: &str) -> String {
    key.split('+')
        .map(|part| match part {
            "Ctrl" => "CTRL",
            "Alt" => "ALT",
            "Shift" => "SHIFT",
            "Super" => "LOGO",
            "ArrowLeft" => "Left",
            "ArrowRight" => "Right",
            "ArrowUp" => "Up",
            "ArrowDown" => "Down",
            "Space" => "space",
            other => other
                .strip_prefix("Key")
                .or_else(|| other.strip_prefix("Digit"))
                .unwrap_or(other),
        })
        .collect::<Vec<_>>()
        .join("+")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_duplicates_and_unknown_actions_before_registration() {
        let mut config = Config {
            enabled: true,
            bindings: HashMap::from([
                ("next".into(), "Ctrl+Alt+ArrowRight".into()),
                ("previous".into(), "Ctrl+Alt+ArrowRight".into()),
            ]),
        };
        assert!(validate(&config).is_err());
        config.bindings.remove("previous");
        assert_eq!(validate(&config).unwrap().len(), 1);
        config.bindings.insert("bad".into(), "Space".into());
        assert!(validate(&config).is_err());
    }
    #[test]
    fn converts_recorded_keys_to_portal_accelerators() {
        assert_eq!(portal_trigger("Ctrl+Alt+ArrowLeft"), "CTRL+ALT+Left");
        assert_eq!(portal_trigger("Super+Shift+KeyP"), "LOGO+SHIFT+P");
        assert_eq!(portal_trigger("Ctrl+Alt+Space"), "CTRL+ALT+space");
        assert_eq!(portal_trigger("Ctrl+Digit9"), "CTRL+9");
    }
}
