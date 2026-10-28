//! Bounded, read-only rollout metadata. No prompt/reply text is retained or emitted.
use super::model::{MAX_TASKS, Notice, Phase, Task, label, valid_id};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};
const READ_BYTES: usize = 128 * 1024;
const SCAN_BUDGET: usize = 4096;

fn stamp(v: &Value) -> Option<u64> {
    chrono::DateTime::parse_from_rfc3339(v.get("timestamp")?.as_str()?)
        .ok()
        .and_then(|d| u64::try_from(d.timestamp()).ok())
}
fn parent(v: &Value) -> Option<String> {
    let id = v
        .get("parent_thread_id")
        .or_else(|| v.get("parentThreadId"))
        .or_else(|| v.pointer("/source/subagent/thread_spawn/parent_thread_id"))
        .or_else(|| v.pointer("/source/subAgent/thread_spawn/parent_thread_id"))?
        .as_str()?;
    valid_id(id).then(|| id.to_owned())
}
fn project(v: &Value) -> String {
    v.get("cwd")
        .and_then(Value::as_str)
        .and_then(|s| Path::new(s).file_name())
        .map(|s| label(&s.to_string_lossy()))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "本地任务".into())
}
fn meta(line: &str) -> Option<Task> {
    if !line.contains("session_meta") {
        return None;
    }
    let v: Value = serde_json::from_str(line).ok()?;
    if v.get("type")?.as_str()? != "session_meta" {
        return None;
    }
    let p = v.get("payload")?;
    let id = p.get("id")?.as_str()?;
    if !valid_id(id) {
        return None;
    }
    Some(Task {
        id: id.into(),
        project: project(p),
        parent_id: parent(p),
        turn_id: String::new(),
        phase: Phase::Unknown,
        last_seen: stamp(&v).unwrap_or(0),
        waiting_call: None,
    })
}

pub fn consume(task: &mut Task, line: &str, live: bool, now: u64) -> Option<Notice> {
    if line.len() > READ_BYTES
        || !["event_msg", "response_item", "turn_context"]
            .iter()
            .any(|s| line.contains(s))
    {
        return None;
    }
    let v: Value = serde_json::from_str(line).ok()?;
    let at = stamp(&v)?;
    if at > now.saturating_add(300) || at < task.last_seen {
        return None;
    }
    let p = v.get("payload")?;
    let record = v.get("type")?.as_str()?;
    let kind = p.get("type").and_then(Value::as_str).unwrap_or("");
    let old_phase = task.phase.clone();
    let turn = p
        .get("turn_id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty() && s.len() <= 128);
    if record == "event_msg" {
        match kind {
            "task_started" => {
                let turn = turn?;
                if task.turn_id != turn {
                    task.waiting_call = None;
                }
                task.turn_id = turn.into();
                task.phase = Phase::Running;
            }
            "task_complete" | "turn_aborted" => {
                let turn = turn?;
                if !task.turn_id.is_empty() && task.turn_id != turn {
                    return None;
                }
                task.turn_id = turn.into();
                task.waiting_call = None;
                task.phase = if kind == "task_complete" {
                    Phase::Completed
                } else {
                    Phase::Interrupted
                };
            }
            "exec_approval_request" | "apply_patch_approval_request" => {
                if task.turn_id.is_empty()
                    || !matches!(task.phase, Phase::Running | Phase::Waiting)
                    || turn.is_some_and(|id| id != task.turn_id)
                {
                    return None;
                }
                let id = p
                    .get("call_id")
                    .or_else(|| p.get("id"))
                    .map(|v| {
                        v.as_str()
                            .map(str::to_owned)
                            .unwrap_or_else(|| v.to_string())
                    })
                    .unwrap_or_else(|| kind.into());
                task.waiting_call = Some((id.chars().take(128).collect(), false));
                task.phase = Phase::Waiting;
            }
            "agent_message" | "agent_reasoning" | "token_count" => {}
            _ => return None,
        }
    } else if record == "response_item" {
        if kind == "function_call" {
            let name = p.get("name")?.as_str()?;
            let synchronous = name == "request_user_input" || name.ends_with(".request_user_input");
            let asynchronous =
                name == "request_user_input_async" || name.ends_with(".request_user_input_async");
            if !(synchronous || asynchronous)
                || task.turn_id.is_empty()
                || !matches!(task.phase, Phase::Running | Phase::Waiting)
            {
                return None;
            }
            let call = p
                .get("call_id")?
                .as_str()?
                .chars()
                .take(128)
                .collect::<String>();
            task.waiting_call = Some((call, asynchronous));
            if synchronous {
                task.phase = Phase::Waiting;
            }
        } else if kind == "function_call_output" {
            let (call, asynchronous) = task.waiting_call.as_ref()?;
            if p.get("call_id")?.as_str()? != call {
                return None;
            }
            let accepted = p
                .get("output")
                .and_then(Value::as_str)
                .filter(|s| s.len() <= 16384)
                .and_then(|s| serde_json::from_str::<Value>(s).ok())
                .and_then(|v| v.get("accepted").and_then(Value::as_bool));
            if *asynchronous && accepted == Some(true) {
                task.phase = Phase::Waiting;
            } else {
                task.waiting_call = None;
                task.phase = Phase::Running;
            }
        } else if kind == "message" && p.get("role").and_then(Value::as_str) == Some("user") {
            if task.phase == Phase::Waiting {
                task.phase = Phase::Running;
                task.waiting_call = None;
            }
        } else {
            return None;
        }
    } else {
        return None;
    }
    task.last_seen = at;
    if !live || old_phase == task.phase || now.saturating_sub(at) > 60 {
        return None;
    }
    let kind = match task.phase {
        Phase::Waiting => "waiting",
        Phase::Completed if matches!(old_phase, Phase::Running | Phase::Waiting) => "completed",
        Phase::Interrupted if matches!(old_phase, Phase::Running | Phase::Waiting) => "interrupted",
        _ => return None,
    };
    Some(Notice {
        parent_id: task.parent_id.clone(),
        key: if kind == "waiting" {
            waiting_key(task)
        } else {
            format!("{}:{}:{kind}", task.id, task.turn_id)
        },
        task_id: task.id.clone(),
        project: task.project.clone(),
        kind: kind.into(),
        at,
    })
}

pub fn waiting_key(task: &Task) -> String {
    format!(
        "{}:{}:waiting:{}",
        task.id,
        task.turn_id,
        task.waiting_call
            .as_ref()
            .map(|(id, _)| id.as_str())
            .unwrap_or("event")
    )
}

struct Cursor {
    offset: u64,
    modified: std::time::SystemTime,
    task: Task,
    discarding: bool,
}
#[derive(Default)]
pub struct Reader {
    cursors: HashMap<PathBuf, Cursor>,
    primed: bool,
}
fn discover(
    root: &Path,
    path: &Path,
    depth: usize,
    budget: &mut usize,
    out: &mut Vec<(std::time::SystemTime, PathBuf)>,
) {
    if depth > 3 || *budget == 0 {
        return;
    }
    let Ok(entries) = fs::read_dir(path) else {
        return;
    };
    let mut entries = entries.take(512).flatten().collect::<Vec<_>>();
    entries.sort_by_key(|e| std::cmp::Reverse(e.file_name()));
    for entry in entries {
        if *budget == 0 {
            break;
        }
        *budget -= 1;
        let p = entry.path();
        let Ok(m) = fs::symlink_metadata(&p) else {
            continue;
        };
        if m.file_type().is_symlink() {
            continue;
        }
        if m.is_dir() {
            discover(root, &p, depth + 1, budget, out);
        } else if m.is_file()
            && p.extension().is_some_and(|e| e == "jsonl")
            && p.canonicalize().is_ok_and(|p| p.starts_with(root))
            && let Ok(at) = m.modified()
        {
            out.push((at, p));
        }
    }
}
impl Reader {
    pub fn poll(&mut self, home: &Path, now: u64) -> Result<(Vec<Task>, Vec<Notice>), String> {
        let root = home
            .join("sessions")
            .canonicalize()
            .map_err(|_| "未找到本机 Codex 会话目录".to_owned())?;
        let mut files = vec![];
        let mut budget = SCAN_BUDGET;
        discover(&root, &root, 0, &mut budget, &mut files);
        files.sort_by_key(|v| std::cmp::Reverse(v.0));
        files.truncate(MAX_TASKS);
        self.cursors
            .retain(|p, _| files.iter().any(|(_, f)| f == p));
        let mut notices = vec![];
        for (modified, p) in files {
            if !fs::symlink_metadata(&p).is_ok_and(|m| !m.file_type().is_symlink())
                || !p.canonicalize().is_ok_and(|v| v.starts_with(&root))
            {
                continue;
            }
            let mut options = fs::OpenOptions::new();
            options.read(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.custom_flags(if cfg!(target_os = "macos") {
                    0x100
                } else {
                    0x20000
                });
            }
            let Ok(mut file) = options.open(&p) else {
                continue;
            };
            let Ok(m) = file.metadata() else {
                continue;
            };
            if !m.is_file() {
                continue;
            }
            let size = m.len();
            let existing = self.cursors.get(&p);
            if existing.is_some_and(|c| c.offset == size && c.modified == modified) {
                continue;
            }
            let fresh = existing.is_none_or(|c| c.offset > size);
            if fresh {
                let mut header = vec![0; size.min(32 * 1024) as usize];
                if file.read_exact(&mut header).is_err() {
                    continue;
                }
                let Some(task) = String::from_utf8_lossy(&header).lines().find_map(meta) else {
                    continue;
                };
                // Hydrate recent turn boundaries once. Large tool output must not hide task_started.
                let offset = size.saturating_sub(4 * 1024 * 1024);
                if file.seek(SeekFrom::Start(offset)).is_err() {
                    continue;
                }
                let mut tail = vec![0; (size - offset) as usize];
                if file.read_exact(&mut tail).is_err() {
                    continue;
                }
                let mut task = task;
                let last = tail.iter().rposition(|b| *b == b'\n');
                let skip = if offset > 0 {
                    tail.iter()
                        .position(|b| *b == b'\n')
                        .map(|n| n + 1)
                        .unwrap_or(tail.len())
                } else {
                    0
                };
                if let Some(last) = last
                    && skip <= last
                {
                    for line in tail[skip..=last].split(|b| *b == b'\n') {
                        if line.len() <= READ_BYTES
                            && let Ok(line) = std::str::from_utf8(line)
                            && let Some(n) = consume(&mut task, line, self.primed, now)
                        {
                            notices.push(n);
                        }
                    }
                }
                let end = last.map(|i| offset + i as u64 + 1).unwrap_or(offset);
                self.cursors.insert(
                    p.clone(),
                    Cursor {
                        offset: end,
                        modified,
                        task,
                        discarding: last.is_none() && offset > 0,
                    },
                );
                continue;
            }
            let c = self.cursors.get_mut(&p).expect("cursor initialized");
            let old = c.offset;
            if file.seek(SeekFrom::Start(old)).is_err() {
                continue;
            }
            let mut bytes = vec![0; size.saturating_sub(old).min(READ_BYTES as u64) as usize];
            if file.read_exact(&mut bytes).is_err() {
                continue;
            }
            // Retry partial records; discard oversized records without stalling the cursor.
            let Some(last) = bytes.iter().rposition(|b| *b == b'\n') else {
                if bytes.len() == READ_BYTES {
                    c.offset = old + bytes.len() as u64;
                    c.discarding = true;
                }
                continue;
            };
            let skip = if c.discarding {
                bytes
                    .iter()
                    .position(|b| *b == b'\n')
                    .map(|n| n + 1)
                    .unwrap_or(last + 1)
            } else {
                0
            };
            if skip <= last {
                for line in bytes[skip..=last].split(|b| *b == b'\n') {
                    if let Ok(line) = std::str::from_utf8(line)
                        && let Some(n) = consume(&mut c.task, line, self.primed, now)
                    {
                        notices.push(n);
                    }
                }
            }
            c.discarding = false;
            c.offset = old + last as u64 + 1;
            c.modified = modified;
        }
        let mut tasks = self
            .cursors
            .values()
            .map(|c| c.task.clone())
            .filter(|t| now.saturating_sub(t.last_seen) < 86400)
            .collect::<Vec<_>>();
        for t in &mut tasks {
            if matches!(t.phase, Phase::Running | Phase::Waiting)
                && now.saturating_sub(t.last_seen) > 600
            {
                t.phase = Phase::Unknown;
            }
        }
        self.primed = true;
        tasks.sort_by_key(|v| std::cmp::Reverse(v.last_seen));
        Ok((tasks, notices))
    }
}
