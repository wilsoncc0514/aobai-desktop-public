use serde_json::{Value, json};
use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};

fn executable() -> Option<PathBuf> {
    let mut candidates = vec![];
    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from(
            "/Applications/Codex.app/Contents/Resources/codex",
        ));
        candidates.push(PathBuf::from(
            "/Applications/ChatGPT.app/Contents/Resources/codex",
        ));
        if let Some(base) = std::env::var_os("HOME") {
            candidates
                .push(PathBuf::from(base).join("Applications/Codex.app/Contents/Resources/codex"));
        }
    }
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths).take(64) {
            candidates.push(dir.join(if cfg!(windows) { "codex.exe" } else { "codex" }));
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}
struct OwnedChild(Child);
impl Drop for OwnedChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// Only owns its newly spawned quota helper. No turns, login, approvals or global process operations.
pub fn read(home: &Path, generation: &Arc<AtomicU64>, expected: u64) -> Result<Value, String> {
    let exe = executable().ok_or_else(|| "未找到 Codex CLI，任务跟随仍可使用".to_owned())?;
    read_executable(&exe, home, generation, expected, Duration::from_secs(12))
}
fn read_executable(
    exe: &Path,
    home: &Path,
    generation: &Arc<AtomicU64>,
    expected: u64,
    timeout: Duration,
) -> Result<Value, String> {
    let mut command = Command::new(exe);
    command
        .args([
            "-s",
            "read-only",
            "-a",
            "never",
            "app-server",
            "--listen",
            "stdio://",
        ])
        .env("CODEX_HOME", home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = OwnedChild(
        command
            .spawn()
            .map_err(|_| "Codex 额度读取进程启动失败".to_owned())?,
    );
    let mut input = child.0.stdin.take().ok_or("额度管道不可用")?;
    let output = child.0.stdout.take().ok_or("额度管道不可用")?;
    let (tx, rx) = mpsc::sync_channel(8);
    std::thread::spawn(move || {
        let mut reader = BufReader::new(output);
        loop {
            let mut line = vec![];
            // take() bounds one protocol line, including malicious/invalid output.
            match (&mut reader)
                .take(512 * 1024 + 1)
                .read_until(b'\n', &mut line)
            {
                Ok(0) | Err(_) => break,
                Ok(n) if n > 512 * 1024 => break,
                Ok(_) => {
                    if tx.send(line).is_err() {
                        break;
                    }
                }
            }
        }
    });
    let deadline = Instant::now() + timeout;
    let mut request = |id: u64, method: &str, params: Option<Value>| -> Result<Value, String> {
        let mut msg = json!({"id":id,"method":method});
        if let Some(p) = params {
            msg["params"] = p;
        }
        writeln!(input, "{msg}").map_err(|_| "额度请求写入失败".to_owned())?;
        loop {
            if generation.load(Ordering::SeqCst) != expected {
                return Err("读取已取消".into());
            }
            if Instant::now() >= deadline {
                return Err("额度读取超时，可稍后刷新".into());
            }
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(line) => {
                    let Ok(v) = serde_json::from_slice::<Value>(&line) else {
                        return Err("额度响应格式不兼容".into());
                    };
                    if v.get("id").and_then(Value::as_u64) != Some(id) {
                        continue;
                    }
                    if v.get("error").is_some() {
                        return Err("Codex 未提供额度，请检查登录状态或版本".into());
                    }
                    if id == 1 {
                        writeln!(input, "{{\"method\":\"initialized\"}}")
                            .map_err(|_| "初始化通知失败".to_owned())?;
                    }
                    return v
                        .get("result")
                        .cloned()
                        .ok_or_else(|| "额度响应缺少结果".into());
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(_) => return Err("Codex 额度连接已关闭".into()),
            }
        }
    };
    request(
        1,
        "initialize",
        Some(json!({"clientInfo":{"name":"aobai-desktop","version":"0.4.1"}})),
    )?;
    let account = request(2, "account/read", Some(json!({"refreshToken":false})))?;
    if account.get("account").is_none_or(Value::is_null) {
        return Err("请先在 Codex 中登录，鳌拜不收集登录凭据".into());
    }
    if account.pointer("/account/type").and_then(Value::as_str) == Some("apiKey") {
        return Err("API Key 登录不提供订阅额度".into());
    }
    request(3, "account/rateLimits/read", None)
}
use std::io::Read;

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    fn helper(body: &str) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("codex-fixture");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        (dir, path)
    }
    #[test]
    fn protocol_initializes_before_reading_and_never_starts_turns() {
        let (dir, path) = helper(
            r#"ready=no
while IFS= read -r line; do
case "$line" in
  *'"method":"initialize"'*) echo '{"id":1,"result":{}}';;
  *'"method":"initialized"'*) ready=yes;;
  *'"method":"account/read"'*) [ "$ready" = yes ] || exit 2; echo '{"id":2,"result":{"account":{"type":"chatgpt"}}}';;
  *'"method":"account/rateLimits/read"'*) echo '{"id":3,"result":{"rateLimits":{"primary":{"usedPercent":40}}}}';;
  *) exit 3;;
esac
done"#,
        );
        let result = read_executable(
            &path,
            dir.path(),
            &Arc::new(AtomicU64::new(1)),
            1,
            Duration::from_secs(2),
        )
        .unwrap();
        assert_eq!(
            result.pointer("/rateLimits/primary/usedPercent"),
            Some(&json!(40))
        );
    }
    #[test]
    fn cancellation_and_deadline_stop_owned_helper() {
        let (dir, path) = helper("while IFS= read -r line; do :; done");
        let start = Instant::now();
        let generation = Arc::new(AtomicU64::new(2));
        assert!(
            read_executable(&path, dir.path(), &generation, 1, Duration::from_secs(2))
                .unwrap_err()
                .contains("取消")
        );
        assert!(start.elapsed() < Duration::from_secs(1));
        let start = Instant::now();
        assert!(
            read_executable(
                &path,
                dir.path(),
                &generation,
                2,
                Duration::from_millis(150)
            )
            .unwrap_err()
            .contains("超时")
        );
        assert!(start.elapsed() < Duration::from_secs(1));
    }
}
