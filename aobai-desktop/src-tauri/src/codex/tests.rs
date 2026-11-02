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
fn root_metadata() -> String {
    line(
        "session_meta",
        json!({"id":ID,"cwd":"/private/example/project"}),
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
    fs::write(&path, root_metadata() + &event("task_started")).unwrap();
    let mut r = Reader::default();
    let (tasks, notes) = r.poll(temp.path(), clock()).unwrap();
    assert!(notes.is_empty());
    assert_eq!(tasks[0].phase, Phase::Running);
    assert!(tasks[0].parent_id.is_none());
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
        root_metadata() + &event("task_started") + &event("task_complete"),
    )
    .unwrap();
    assert_eq!(r.poll(temp.path(), clock()).unwrap().1.len(), 1);
}
#[test]
fn partial_and_oversize_lines_do_not_stall() {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join("sessions")).unwrap();
    let path = temp.path().join("sessions/log.jsonl");
    fs::write(&path, root_metadata() + &event("task_started")).unwrap();
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

#[test]
fn child_completion_updates_status_without_interrupting_parent() {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join("sessions")).unwrap();
    let path = temp.path().join("sessions/child.jsonl");
    fs::write(&path, metadata() + &event("task_started")).unwrap();
    let mut reader = Reader::default();
    reader.poll(temp.path(), clock()).unwrap();
    fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .unwrap()
        .write_all(event("task_complete").as_bytes())
        .unwrap();
    let (tasks, notices) = reader.poll(temp.path(), clock()).unwrap();
    assert_eq!(tasks[0].phase, Phase::Completed);
    assert!(notices.is_empty());
}

#[test]
fn accepted_async_question_survives_turn_completion_until_next_turn() {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join("sessions")).unwrap();
    let path = temp.path().join("sessions/root.jsonl");
    fs::write(&path, root_metadata() + &event("task_started")).unwrap();
    let mut reader = Reader::default();
    reader.poll(temp.path(), clock()).unwrap();
    let mut log = fs::OpenOptions::new().append(true).open(&path).unwrap();
    log.write_all(
        line(
            "response_item",
            json!({"type":"function_call","name":"request_user_input_async","call_id":"q"}),
        )
        .as_bytes(),
    )
    .unwrap();
    log.write_all(line("event_msg", json!({"type":"item_completed","item":{"type":"AgentMessage","phase":"final_answer","delivery":"async","questions":[{}]}})).as_bytes()).unwrap();
    log.write_all(
        line(
            "response_item",
            json!({"type":"function_call_output","call_id":"q","output":"{\"accepted\":true}"}),
        )
        .as_bytes(),
    )
    .unwrap();
    log.write_all(event("task_complete").as_bytes()).unwrap();
    let (tasks, notices) = reader.poll(temp.path(), clock()).unwrap();
    assert_eq!(tasks[0].phase, Phase::Waiting);
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].kind, "waiting");
    let (tasks, _) = reader.poll(temp.path(), clock() + 601).unwrap();
    assert_eq!(tasks[0].phase, Phase::Waiting);
    log.write_all(
        line(
            "event_msg",
            json!({"type":"task_started","turn_id":"turn2"}),
        )
        .as_bytes(),
    )
    .unwrap();
    let (tasks, notices) = reader.poll(temp.path(), clock()).unwrap();
    assert_eq!(tasks[0].phase, Phase::Running);
    assert!(notices.is_empty());
}

#[test]
fn desktop_final_answer_then_task_complete_produces_one_completion() {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join("sessions")).unwrap();
    let path = temp.path().join("sessions/root.jsonl");
    fs::write(&path, root_metadata() + &event("task_started")).unwrap();
    let mut reader = Reader::default();
    reader.poll(temp.path(), clock()).unwrap();
    let mut log = fs::OpenOptions::new().append(true).open(&path).unwrap();
    log.write_all(
        line(
            "event_msg",
            json!({"type":"item_completed","item":{"type":"AgentMessage","phase":"final_answer"}}),
        )
        .as_bytes(),
    )
    .unwrap();
    log.write_all(event("task_complete").as_bytes()).unwrap();
    let (tasks, notices) = reader.poll(temp.path(), clock()).unwrap();
    assert_eq!(tasks[0].phase, Phase::Completed);
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].kind, "completed");
    assert!(reader.poll(temp.path(), clock()).unwrap().1.is_empty());
}

#[test]
fn catches_up_with_burst_of_output_before_completion() {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join("sessions")).unwrap();
    let path = temp.path().join("sessions/root.jsonl");
    fs::write(&path, root_metadata() + &event("task_started")).unwrap();
    let mut reader = Reader::default();
    reader.poll(temp.path(), clock()).unwrap();
    let mut log = fs::OpenOptions::new().append(true).open(&path).unwrap();
    for _ in 0..400 {
        log.write_all(
            line(
                "response_item",
                json!({"type":"function_call_output","output":"x".repeat(800)}),
            )
            .as_bytes(),
        )
        .unwrap();
    }
    log.write_all(event("task_complete").as_bytes()).unwrap();
    let (tasks, notices) = reader.poll(temp.path(), clock()).unwrap();
    assert_eq!(tasks[0].phase, Phase::Completed);
    assert_eq!(notices.len(), 1);
}

#[test]
fn waiting_notice_is_not_deleted_when_task_is_missing_or_unknown() {
    let waiting = Notice {
        parent_id: None,
        key: format!("{}:t:waiting:q", ID),
        task_id: ID.into(),
        project: "project".into(),
        kind: "waiting".into(),
        at: clock(),
    };
    let mut task = Task {
        id: ID.into(),
        turn_id: "t".into(),
        project: "project".into(),
        parent_id: None,
        phase: Phase::Unknown,
        last_seen: clock(),
        waiting_call: None,
    };
    assert!(keep_notice(&waiting, &[], clock()));
    assert!(keep_notice(&waiting, &[task.clone()], clock()));
    task.phase = Phase::Running;
    assert!(!keep_notice(&waiting, &[task.clone()], clock()));
    task.phase = Phase::Waiting;
    task.waiting_call = Some(("q".into(), true));
    assert!(keep_notice(&waiting, &[task.clone()], clock()));
    task.waiting_call = Some(("new".into(), true));
    assert!(!keep_notice(&waiting, &[task], clock()));
    assert!(!keep_notice(&waiting, &[], clock() + 86400));
}

#[test]
fn completed_turn_followed_by_new_turn_in_same_poll_is_not_a_completion_alert() {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join("sessions")).unwrap();
    let path = temp.path().join("sessions/root.jsonl");
    fs::write(&path, root_metadata() + &event("task_started")).unwrap();
    let mut reader = Reader::default();
    reader.poll(temp.path(), clock()).unwrap();
    let mut log = fs::OpenOptions::new().append(true).open(&path).unwrap();
    log.write_all(event("task_complete").as_bytes()).unwrap();
    log.write_all(
        line(
            "event_msg",
            json!({"type":"task_started","turn_id":"turn2"}),
        )
        .as_bytes(),
    )
    .unwrap();
    let (tasks, notices) = reader.poll(temp.path(), clock()).unwrap();
    assert_eq!(tasks[0].phase, Phase::Running);
    assert!(notices.is_empty());
    log.write_all(
        line(
            "event_msg",
            json!({"type":"task_complete","turn_id":"turn2"}),
        )
        .as_bytes(),
    )
    .unwrap();
    let (tasks, notices) = reader.poll(temp.path(), clock()).unwrap();
    assert_eq!(tasks[0].phase, Phase::Completed);
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].kind, "completed");
}

#[test]
fn backlog_does_not_publish_completion_before_later_start_is_read() {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join("sessions")).unwrap();
    let path = temp.path().join("sessions/root.jsonl");
    fs::write(&path, root_metadata() + &event("task_started")).unwrap();
    let mut reader = Reader::default();
    reader.poll(temp.path(), clock()).unwrap();
    let mut log = fs::OpenOptions::new().append(true).open(&path).unwrap();
    log.write_all(event("task_complete").as_bytes()).unwrap();
    for _ in 0..1500 {
        log.write_all(
            line(
                "response_item",
                json!({"type":"function_call_output","output":"x".repeat(900)}),
            )
            .as_bytes(),
        )
        .unwrap();
    }
    log.write_all(
        line(
            "event_msg",
            json!({"type":"task_started","turn_id":"turn2"}),
        )
        .as_bytes(),
    )
    .unwrap();
    let (tasks, notices) = reader.poll(temp.path(), clock()).unwrap();
    assert_eq!(tasks[0].phase, Phase::Unknown);
    assert!(notices.is_empty());
    let (tasks, notices) = reader.poll(temp.path(), clock()).unwrap();
    assert_eq!(tasks[0].phase, Phase::Running);
    assert!(notices.is_empty());
}

#[test]
fn completion_in_backlog_is_delivered_when_caught_up() {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join("sessions")).unwrap();
    let path = temp.path().join("sessions/root.jsonl");
    fs::write(&path, root_metadata() + &event("task_started")).unwrap();
    let mut reader = Reader::default();
    reader.poll(temp.path(), clock()).unwrap();
    let mut log = fs::OpenOptions::new().append(true).open(&path).unwrap();
    log.write_all(event("task_complete").as_bytes()).unwrap();
    for _ in 0..1500 {
        log.write_all(
            line(
                "response_item",
                json!({"type":"function_call_output","output":"x".repeat(900)}),
            )
            .as_bytes(),
        )
        .unwrap();
    }
    let (tasks, notices) = reader.poll(temp.path(), clock()).unwrap();
    assert_eq!(tasks[0].phase, Phase::Unknown);
    assert!(notices.is_empty());
    let (tasks, notices) = reader.poll(temp.path(), clock()).unwrap();
    assert_eq!(tasks[0].phase, Phase::Completed);
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].kind, "completed");
}

#[test]
fn partial_next_record_defers_completion_until_record_is_complete() {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join("sessions")).unwrap();
    let path = temp.path().join("sessions/root.jsonl");
    fs::write(&path, root_metadata() + &event("task_started")).unwrap();
    let mut reader = Reader::default();
    reader.poll(temp.path(), clock()).unwrap();
    let mut log = fs::OpenOptions::new().append(true).open(&path).unwrap();
    let next = line(
        "event_msg",
        json!({"type":"task_started","turn_id":"turn2"}),
    );
    let split = next.len() / 2;
    log.write_all(event("task_complete").as_bytes()).unwrap();
    log.write_all(&next.as_bytes()[..split]).unwrap();
    let (tasks, notices) = reader.poll(temp.path(), clock()).unwrap();
    assert_eq!(tasks[0].phase, Phase::Unknown);
    assert!(notices.is_empty());
    log.write_all(&next.as_bytes()[split..]).unwrap();
    let (tasks, notices) = reader.poll(temp.path(), clock()).unwrap();
    assert_eq!(tasks[0].phase, Phase::Running);
    assert!(notices.is_empty());
}

#[test]
fn concurrent_child_completion_and_parent_question_remain_distinct() {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join("sessions")).unwrap();
    let root_path = temp.path().join("sessions/root.jsonl");
    let child_path = temp.path().join("sessions/child.jsonl");
    let child_id = "22222222-2222-4222-8222-222222222222";
    let child_metadata = line(
        "session_meta",
        json!({"id":child_id,"cwd":"/private/example/project","source":{"subagent":{"thread_spawn":{"parent_thread_id":ID}}}}),
    );
    fs::write(&root_path, root_metadata() + &event("task_started")).unwrap();
    fs::write(&child_path, child_metadata + &event("task_started")).unwrap();
    let mut reader = Reader::default();
    let (tasks, notices) = reader.poll(temp.path(), clock()).unwrap();
    assert_eq!(tasks.len(), 2);
    assert!(notices.is_empty());
    fs::OpenOptions::new()
        .append(true)
        .open(&child_path)
        .unwrap()
        .write_all(event("task_complete").as_bytes())
        .unwrap();
    let mut root = fs::OpenOptions::new()
        .append(true)
        .open(&root_path)
        .unwrap();
    root.write_all(
        line(
            "response_item",
            json!({"type":"function_call","name":"request_user_input_async","call_id":"q"}),
        )
        .as_bytes(),
    )
    .unwrap();
    root.write_all(
        line(
            "response_item",
            json!({"type":"function_call_output","call_id":"q","output":"{\"accepted\":true}"}),
        )
        .as_bytes(),
    )
    .unwrap();
    root.write_all(event("task_complete").as_bytes()).unwrap();
    let (tasks, notices) = reader.poll(temp.path(), clock()).unwrap();
    assert_eq!(
        tasks.iter().find(|t| t.id == ID).unwrap().phase,
        Phase::Waiting
    );
    let child = tasks.iter().find(|t| t.id == child_id).unwrap();
    assert_eq!(child.phase, Phase::Completed);
    assert_eq!(child.parent_id.as_deref(), Some(ID));
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].task_id, ID);
    assert_eq!(notices[0].kind, "waiting");
    root.write_all(
        line(
            "event_msg",
            json!({"type":"task_started","turn_id":"turn2"}),
        )
        .as_bytes(),
    )
    .unwrap();
    root.write_all(
        line(
            "event_msg",
            json!({"type":"task_complete","turn_id":"turn2"}),
        )
        .as_bytes(),
    )
    .unwrap();
    let (tasks, notices) = reader.poll(temp.path(), clock()).unwrap();
    assert_eq!(
        tasks.iter().find(|t| t.id == ID).unwrap().phase,
        Phase::Completed
    );
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].task_id, ID);
    assert_eq!(notices[0].kind, "completed");
}

#[test]
fn delayed_but_still_pending_question_is_reported_after_catchup() {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join("sessions")).unwrap();
    let path = temp.path().join("sessions/root.jsonl");
    fs::write(&path, root_metadata() + &event("task_started")).unwrap();
    let mut reader = Reader::default();
    reader.poll(temp.path(), clock()).unwrap();
    let mut log = fs::OpenOptions::new().append(true).open(&path).unwrap();
    log.write_all(
        line(
            "response_item",
            json!({"type":"function_call","name":"request_user_input_async","call_id":"q"}),
        )
        .as_bytes(),
    )
    .unwrap();
    log.write_all(
        line(
            "response_item",
            json!({"type":"function_call_output","call_id":"q","output":"{\"accepted\":true}"}),
        )
        .as_bytes(),
    )
    .unwrap();
    log.write_all(event("task_complete").as_bytes()).unwrap();
    let (tasks, notices) = reader.poll(temp.path(), clock() + 61).unwrap();
    assert_eq!(tasks[0].phase, Phase::Waiting);
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].kind, "waiting");
    assert!(reader.poll(temp.path(), clock() + 62).unwrap().1.is_empty());
}

#[test]
fn delayed_resolved_question_and_completion_do_not_replay() {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join("sessions")).unwrap();
    let path = temp.path().join("sessions/root.jsonl");
    fs::write(&path, root_metadata() + &event("task_started")).unwrap();
    let mut reader = Reader::default();
    reader.poll(temp.path(), clock()).unwrap();
    let mut log = fs::OpenOptions::new().append(true).open(&path).unwrap();
    log.write_all(
        line(
            "response_item",
            json!({"type":"function_call","name":"request_user_input_async","call_id":"q"}),
        )
        .as_bytes(),
    )
    .unwrap();
    log.write_all(
        line(
            "response_item",
            json!({"type":"function_call_output","call_id":"q","output":"{\"accepted\":true}"}),
        )
        .as_bytes(),
    )
    .unwrap();
    log.write_all(line("response_item", json!({"type":"message","role":"user"})).as_bytes())
        .unwrap();
    log.write_all(event("task_complete").as_bytes()).unwrap();
    let (tasks, notices) = reader.poll(temp.path(), clock() + 61).unwrap();
    assert_eq!(tasks[0].phase, Phase::Completed);
    assert!(notices.is_empty());
}

#[test]
fn delayed_question_survives_multi_poll_backlog() {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join("sessions")).unwrap();
    let path = temp.path().join("sessions/root.jsonl");
    fs::write(&path, root_metadata() + &event("task_started")).unwrap();
    let mut reader = Reader::default();
    reader.poll(temp.path(), clock()).unwrap();
    let mut log = fs::OpenOptions::new().append(true).open(&path).unwrap();
    log.write_all(
        line(
            "response_item",
            json!({"type":"function_call","name":"request_user_input_async","call_id":"q"}),
        )
        .as_bytes(),
    )
    .unwrap();
    log.write_all(
        line(
            "response_item",
            json!({"type":"function_call_output","call_id":"q","output":"{\"accepted\":true}"}),
        )
        .as_bytes(),
    )
    .unwrap();
    log.write_all(event("task_complete").as_bytes()).unwrap();
    for _ in 0..1500 {
        log.write_all(
            line(
                "response_item",
                json!({"type":"function_call_output","output":"x".repeat(900)}),
            )
            .as_bytes(),
        )
        .unwrap();
    }
    let (tasks, notices) = reader.poll(temp.path(), clock() + 61).unwrap();
    assert_eq!(tasks[0].phase, Phase::Unknown);
    assert!(notices.is_empty());
    let (tasks, notices) = reader.poll(temp.path(), clock() + 63).unwrap();
    assert_eq!(tasks[0].phase, Phase::Waiting);
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].kind, "waiting");
}
