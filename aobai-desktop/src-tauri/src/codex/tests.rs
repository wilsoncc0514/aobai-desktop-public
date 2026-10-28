use super::{logs::Reader, model::*, *};
use serde_json::json;
use std::io::Write;
const ID: &str = "11111111-1111-4111-8111-111111111111";
fn line(kind: &str, payload: serde_json::Value) -> String {
    json!({"timestamp":"2026-10-28T00:00:00Z","type":kind,"payload":payload}).to_string() + "\n"
}
fn metadata() -> String {
    line(
        "session_meta",
        json!({"id":ID,"cwd":"/private/example/project","source":{"subagent":{"thread_spawn":{"parent_thread_id":"22222222-2222-4222-8222-222222222222"}}}}),
    )
}
fn event(kind: &str) -> String {
    line("event_msg", json!({"type":kind,"turn_id":"turn1"}))
}
fn clock() -> u64 {
    1793145600
}
#[test]
fn ids_and_quota_are_validated() {
    assert!(valid_id(ID));
    assert!(!valid_id("../11111111-1111-4111-8111-111111111111"));
    let q = decode_quota(
        &json!({"rateLimits":{"primary":{"usedPercent":99}},"rateLimitsByLimitId":{"codex":{"primary":{"usedPercent":25,"windowDurationMins":300,"resetsAt":123},"secondary":{"usedPercent":null}}}}),
    );
    assert_eq!(q.len(), 2);
    assert_eq!(q[0].remaining_percent, Some(75.));
    assert_eq!(q[1].remaining_percent, None);
    assert!(decode_quota(&json!({})).is_empty());
}
#[test]
fn baseline_does_not_replay_history_and_live_completion_is_once() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path().join("sessions/2026/10/28");
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("rollout.jsonl");
    fs::write(&path, metadata() + &event("task_started")).unwrap();
    let mut r = Reader::default();
    let (tasks, notes) = r.poll(temp.path(), clock()).unwrap();
    assert!(notes.is_empty());
    assert_eq!(tasks[0].phase, Phase::Running);
    assert!(tasks[0].parent_id.is_some());
    assert_eq!(tasks[0].project, "project");
    fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .unwrap()
        .write_all(event("task_complete").as_bytes())
        .unwrap();
    let (tasks, notes) = r.poll(temp.path(), clock()).unwrap();
    assert_eq!(tasks[0].phase, Phase::Completed);
    assert_eq!(notes.len(), 1);
    assert!(r.poll(temp.path(), clock()).unwrap().1.is_empty());
}
#[test]
fn new_files_after_baseline_emit_but_eof_never_completes() {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join("sessions")).unwrap();
    let mut r = Reader::default();
    r.poll(temp.path(), clock()).unwrap();
    fs::write(
        temp.path().join("sessions/new.jsonl"),
        metadata() + &event("task_started") + &event("task_complete"),
    )
    .unwrap();
    assert_eq!(r.poll(temp.path(), clock()).unwrap().1.len(), 1);
}
#[test]
fn partial_and_oversize_lines_do_not_stall() {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join("sessions")).unwrap();
    let path = temp.path().join("sessions/log.jsonl");
    fs::write(&path, metadata() + &event("task_started")).unwrap();
    let mut r = Reader::default();
    r.poll(temp.path(), clock()).unwrap();
    let mut f = fs::OpenOptions::new().append(true).open(&path).unwrap();
    f.write_all(&vec![b'x'; 300000]).unwrap();
    r.poll(temp.path(), clock()).unwrap();
    r.poll(temp.path(), clock()).unwrap();
    f.write_all(b"\n").unwrap();
    f.write_all(event("task_complete").as_bytes()).unwrap();
    let (_, notes) = r.poll(temp.path(), clock()).unwrap();
    assert_eq!(notes.len(), 1);
}
#[test]
fn explicit_questions_wait_and_user_reply_clears_them() {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join("sessions")).unwrap();
    let path = temp.path().join("sessions/log.jsonl");
    fs::write(&path, metadata() + &event("task_started")).unwrap();
    let mut r = Reader::default();
    r.poll(temp.path(), clock()).unwrap();
    let mut f = fs::OpenOptions::new().append(true).open(&path).unwrap();
    f.write_all(line("response_item",json!({"type":"function_call","name":"functions.request_user_input_async","call_id":"q"})).as_bytes()).unwrap();
    assert_eq!(
        r.poll(temp.path(), clock()).unwrap().0[0].phase,
        Phase::Running
    );
    f.write_all(
        line(
            "response_item",
            json!({"type":"function_call_output","call_id":"q","output":"{\"accepted\":true}"}),
        )
        .as_bytes(),
    )
    .unwrap();
    let (tasks, notes) = r.poll(temp.path(), clock()).unwrap();
    assert_eq!(tasks[0].phase, Phase::Waiting);
    assert_eq!(notes.len(), 1);
    f.write_all(
        line(
            "response_item",
            json!({"type":"message","role":"user","content":"PRIVATE NOT RETAINED"}),
        )
        .as_bytes(),
    )
    .unwrap();
    assert_eq!(
        r.poll(temp.path(), clock()).unwrap().0[0].phase,
        Phase::Running
    );
}
#[test]
fn stale_running_is_unknown_not_completed() {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join("sessions")).unwrap();
    fs::write(
        temp.path().join("sessions/log.jsonl"),
        metadata() + &event("task_started"),
    )
    .unwrap();
    let (tasks, notes) = Reader::default().poll(temp.path(), clock() + 601).unwrap();
    assert_eq!(tasks[0].phase, Phase::Unknown);
    assert!(notes.is_empty());
}
#[cfg(unix)]
#[test]
fn symlinks_are_not_followed() {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join("sessions")).unwrap();
    let elsewhere = tempfile::NamedTempFile::new().unwrap();
    fs::write(elsewhere.path(), metadata() + &event("task_started")).unwrap();
    std::os::unix::fs::symlink(elsewhere.path(), temp.path().join("sessions/link.jsonl")).unwrap();
    assert!(
        Reader::default()
            .poll(temp.path(), clock())
            .unwrap()
            .0
            .is_empty()
    );
}
#[test]
fn preferences_preserve_original_on_failed_save() {
    let temp = tempfile::tempdir().unwrap();
    let p = temp.path().join("missing/settings.json");
    assert!(save(&p, &Preferences::default()).is_err());
}

#[test]
fn separate_questions_in_one_turn_have_distinct_notice_keys() {
    let mut task = Task {
        id: ID.into(),
        turn_id: "t".into(),
        project: "project".into(),
        parent_id: None,
        phase: Phase::Running,
        last_seen: 0,
        waiting_call: None,
    };
    let q = |id: &str| {
        line(
            "response_item",
            json!({"type":"function_call","name":"request_user_input","call_id":id,"arguments":"PRIVATE QUESTION"}),
        )
    };
    let first = logs::consume(&mut task, &q("q1"), true, clock()).unwrap();
    logs::consume(
        &mut task,
        &line(
            "response_item",
            json!({"type":"function_call_output","call_id":"q1","output":"PRIVATE REPLY"}),
        ),
        true,
        clock(),
    );
    let second = logs::consume(&mut task, &q("q2"), true, clock()).unwrap();
    assert_ne!(first.key, second.key);
    assert!(!serde_json::to_string(&task).unwrap().contains("PRIVATE"));
}
#[test]
fn inbox_round_trips_and_unknown_preferences_are_not_silently_discarded() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("prefs.json");
    let mut prefs = Preferences::default();
    prefs.inbox.push(Notice {
        parent_id: None,
        key: "key".into(),
        task_id: ID.into(),
        project: "project".into(),
        kind: "completed".into(),
        at: clock(),
    });
    save(&path, &prefs).unwrap();
    save(&path, &prefs).unwrap();
    let restored: Preferences = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(restored.inbox, prefs.inbox);
    assert!(
        serde_json::from_value::<Preferences>(json!({"enabled":true,"futureVersion":99})).is_err()
    );
}

#[test]
fn initial_hydration_finds_start_before_large_tool_output() {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join("sessions")).unwrap();
    let text = metadata()
        + &event("task_started")
        + &line(
            "response_item",
            json!({"type":"function_call_output","output":"x".repeat(300000)}),
        );
    fs::write(temp.path().join("sessions/log.jsonl"), text).unwrap();
    let (tasks, notices) = Reader::default().poll(temp.path(), clock()).unwrap();
    assert_eq!(tasks[0].phase, Phase::Running);
    assert!(notices.is_empty());
}
