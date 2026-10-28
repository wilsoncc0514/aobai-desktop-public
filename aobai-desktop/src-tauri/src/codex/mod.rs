mod logs;
mod model;
mod quota;
#[cfg(test)]
mod tests;
pub use model::Snapshot;
use model::{MAX_NOTICES, Notice, Phase, decode_quota, now, valid_id};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Preferences {
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    acknowledged: VecDeque<String>,
    #[serde(default)]
    inbox: Vec<Notice>,
}
#[derive(Default)]
struct State {
    view: Snapshot,
    preferences: Preferences,
    path: PathBuf,
}
#[derive(Clone, Default)]
pub struct Service {
    state: Arc<Mutex<State>>,
    generation: Arc<AtomicU64>,
    refresh: Arc<AtomicU64>,
}
#[cfg(windows)]
fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(from: *const u16, to: *const u16, flags: u32) -> i32;
    }
    let from = from
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let to = to
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 0x1 | 0x8) } == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}
#[cfg(not(windows))]
fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::rename(from, to)
}
fn save(path: &Path, prefs: &Preferences) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(prefs).map_err(|_| "跟随设置无法编码")?;
    let tmp = path.with_extension(format!(
        "{}.{}.tmp",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    use std::io::Write;
    let result = (|| {
        let mut file = options.open(&tmp).map_err(|_| "跟随设置无法保存")?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "跟随设置无法保存")?;
        drop(file);
        replace_file(&tmp, path).map_err(|_| "跟随设置无法替换，原设置已保留")
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result.map_err(str::to_owned)
}
fn home() -> Option<PathBuf> {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
                .map(|p| PathBuf::from(p).join(".codex"))
        })
}
impl Service {
    pub fn configure(&self, app: &AppHandle) -> Result<(), String> {
        let dir = app
            .path()
            .app_config_dir()
            .map_err(|_| "无法定位跟随设置目录")?;
        fs::create_dir_all(&dir).map_err(|_| "无法创建跟随设置目录")?;
        let path = dir.join("codex-follow.json");
        let prefs = match fs::metadata(&path) {
            Ok(m) if m.len() > 131072 => return Err("跟随设置过大，未自动覆盖".into()),
            Ok(_) => serde_json::from_slice::<Preferences>(
                &fs::read(&path).map_err(|_| "跟随设置不可读")?,
            )
            .map_err(|_| "跟随设置损坏，未自动覆盖")?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Preferences::default(),
            Err(_) => return Err("跟随设置不可读".into()),
        };
        let enabled = prefs.enabled;
        {
            let mut s = self.state.lock().map_err(|_| "跟随状态不可用")?;
            s.path = path;
            s.preferences = prefs;
            s.preferences.acknowledged.truncate(256);
            s.preferences
                .inbox
                .retain(|n| now().saturating_sub(n.at) < 86400 && valid_id(&n.task_id));
            s.preferences.inbox.truncate(MAX_NOTICES);
        }
        if enabled {
            self.start(app);
        }
        Ok(())
    }
    pub fn snapshot(&self) -> Snapshot {
        self.state
            .lock()
            .map(|s| s.view.clone())
            .unwrap_or_default()
    }
    pub fn stop(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
    }
    pub fn set_enabled(&self, app: &AppHandle, enabled: bool) -> Result<Snapshot, String> {
        {
            let mut s = self.state.lock().map_err(|_| "跟随状态不可用")?;
            if s.path.as_os_str().is_empty() {
                return Err("跟随设置未就绪，未开启监听".into());
            }
            let mut prefs = s.preferences.clone();
            prefs.enabled = enabled;
            save(&s.path, &prefs)?;
            s.preferences = prefs;
        }
        self.stop();
        if enabled {
            self.start(app);
        } else {
            self.publish(app, None, |s| s.view = Snapshot::default());
        }
        Ok(self.snapshot())
    }
    fn publish(&self, app: &AppHandle, expected: Option<u64>, update: impl FnOnce(&mut State)) {
        let Ok(mut s) = self.state.lock() else {
            return;
        };
        if expected.is_some_and(|e| e != self.generation.load(Ordering::SeqCst)) {
            return;
        }
        let old = s.view.clone();
        update(&mut s);
        if old != s.view {
            s.view.revision = old.revision.saturating_add(1);
            let view = s.view.clone();
            drop(s);
            self.emit_view(app, &view);
        }
    }
    fn emit_view(&self, app: &AppHandle, view: &Snapshot) {
        let ui_app = app.clone();
        let ui_view = view.clone();
        let service = self.clone();
        // Never wait for main-thread native UI while holding the state mutex.
        let _ = app.run_on_main_thread(move || {
            if service.snapshot().revision != ui_view.revision {
                return;
            }
            let view = &ui_view;
            if let Some(tray) = ui_app.tray_by_id("main") {
                let tooltip = if view.enabled {
                    format!(
                        "鳌拜 · {} 条未读 · {} 个进行中",
                        view.notices.len(),
                        view.tasks
                            .iter()
                            .filter(|t| t.phase == Phase::Running)
                            .count()
                    )
                } else {
                    "鳌拜·桌面宠物".into()
                };
                let _ = tray.set_tooltip(Some(tooltip));
                #[cfg(target_os = "macos")]
                {
                    let title = "";
                    let _ = tray.set_title(Some(title));
                }
            }
        });
        let _ = app.emit("codex-status", view.clone());
    }
    fn start(&self, app: &AppHandle) {
        let epoch = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        self.publish(app, Some(epoch), |s| {
            s.view = Snapshot {
                notices: s.preferences.inbox.clone(),
                enabled: true,
                source: "starting".into(),
                message: "正在读取本机任务状态".into(),
                ..Snapshot::default()
            };
        });
        let Some(home) = home() else {
            self.publish(app, Some(epoch), |s| {
                s.view.source = "unavailable".into();
                s.view.message = "无法定位 Codex 本地目录".into();
            });
            return;
        };
        let task_self = self.clone();
        let task_app = app.clone();
        let task_home = home.clone();
        std::thread::spawn(move || {
            let mut reader = logs::Reader::default();
            while task_self.generation.load(Ordering::SeqCst) == epoch {
                let result = reader.poll(&task_home, now());
                task_self.publish(&task_app, Some(epoch), |s| match result {
                    Ok((tasks, notices)) => {
                        s.view.tasks = tasks;
                        s.view.source = "localLogs".into();
                        s.view.message = "本地日志跟随；审批仅在有明确事件时提示".into();
                        for n in notices {
                            if !s.preferences.acknowledged.contains(&n.key)
                                && !s.view.notices.iter().any(|v| v.key == n.key)
                            {
                                s.view.notices.insert(0, n);
                            }
                        }
                        s.view.notices.retain(|n| {
                            now().saturating_sub(n.at) < 86400
                                && (n.kind != "waiting"
                                    || s.view.tasks.iter().any(|t| {
                                        t.id == n.task_id
                                            && t.phase == Phase::Waiting
                                            && n.key == logs::waiting_key(t)
                                    }))
                        });
                        s.view.notices.truncate(MAX_NOTICES);
                        if s.preferences.inbox != s.view.notices {
                            let mut prefs = s.preferences.clone();
                            prefs.inbox = s.view.notices.clone();
                            if save(&s.path, &prefs).is_ok() {
                                s.preferences = prefs;
                            } else {
                                s.view.message = "任务跟随正常；未读提醒暂未保存".into();
                            }
                        }
                    }
                    Err(message) => {
                        s.view.source = "unavailable".into();
                        s.view.message = message;
                        s.view
                            .notices
                            .retain(|n| now().saturating_sub(n.at) < 86400);
                        for t in &mut s.view.tasks {
                            if matches!(t.phase, Phase::Running | Phase::Waiting) {
                                t.phase = Phase::Unknown;
                            }
                        }
                    }
                });
                for _ in 0..20 {
                    if task_self.generation.load(Ordering::SeqCst) != epoch {
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
        });
    }
    // Retained for older clients; notification following never starts quota polling.
    pub fn refresh(&self, app: &AppHandle) {
        if !self.snapshot().enabled || self.refresh.swap(1, Ordering::SeqCst) != 0 {
            return;
        }
        let service = self.clone();
        let app = app.clone();
        let epoch = self.generation.load(Ordering::SeqCst);
        std::thread::spawn(move || {
            if let Some(home) = home() {
                let result = quota::read(&home, &service.generation, epoch);
                service.publish(&app, Some(epoch), |s| match result {
                    Ok(v) => {
                        s.view.quota = decode_quota(&v);
                        s.view.quota_updated_at = Some(now());
                        s.view.quota_error = None;
                    }
                    Err(message) => s.view.quota_error = Some(message),
                });
            }
            service.refresh.store(0, Ordering::SeqCst);
        });
    }

    pub fn acknowledge(&self, app: &AppHandle, key: &str) -> Result<(), String> {
        let mut s = self.state.lock().map_err(|_| "跟随状态不可用")?;
        if !s.view.notices.iter().any(|n| n.key == key) {
            return Err("提醒已更新，请重试".into());
        }
        let mut prefs = s.preferences.clone();
        prefs.inbox.retain(|n| n.key != key);
        prefs.acknowledged.push_front(key.into());
        prefs.acknowledged.truncate(256);
        save(&s.path, &prefs)?;
        s.preferences = prefs;
        s.view.notices.retain(|n| n.key != key);
        s.view.revision = s.view.revision.saturating_add(1);
        let view = s.view.clone();
        drop(s);
        self.emit_view(app, &view);
        Ok(())
    }
    pub fn open(&self, app: &AppHandle, id: &str) -> Result<(), String> {
        if !valid_id(id) {
            return Err("无效任务标识".into());
        }
        let captured: Vec<Notice> = {
            let s = self.state.lock().map_err(|_| "跟随状态不可用")?;
            if !s.view.enabled
                || !s.view.tasks.iter().any(|t| t.id == id)
                    && !s.view.notices.iter().any(|n| n.task_id == id)
            {
                return Err("任务已不在当前列表".into());
            }
            s.view
                .notices
                .iter()
                .filter(|n| n.task_id == id)
                .cloned()
                .collect()
        };
        open_conversation(id)?;
        for n in captured {
            if self.snapshot().notices.iter().any(|v| v.key == n.key) {
                self.acknowledge(app, &n.key)?;
            }
        }
        Ok(())
    }
}
fn open_conversation(id: &str) -> Result<(), String> {
    let url = format!("codex://threads/{id}");
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("/usr/bin/open");
        c.arg(&url);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("rundll32.exe");
        c.args(["url.dll,FileProtocolHandler", &url]);
        c
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut cmd = {
        let mut c = Command::new("xdg-open");
        c.arg(&url);
        c
    };
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "无法打开 Codex，请确认已安装桌面应用")?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(s)) => {
                return if s.success() {
                    Ok(())
                } else {
                    Err("打开任务失败，提醒已保留".into())
                };
            }
            Ok(None) if start.elapsed() < Duration::from_secs(5) => {
                std::thread::sleep(Duration::from_millis(50))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("打开任务超时，提醒已保留".into());
            }
        }
    }
}
