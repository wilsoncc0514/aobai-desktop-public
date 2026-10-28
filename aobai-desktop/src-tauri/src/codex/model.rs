use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_TASKS: usize = 32;
pub const MAX_NOTICES: usize = 32;
pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
pub fn valid_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                c == b'-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
}
pub fn label(raw: &str) -> String {
    raw.chars().filter(|c| !c.is_control()).take(48).collect()
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Running,
    Waiting,
    Completed,
    Interrupted,
    Unknown,
}
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub turn_id: String,
    pub project: String,
    pub parent_id: Option<String>,
    pub phase: Phase,
    pub last_seen: u64,
    #[serde(skip)]
    pub waiting_call: Option<(String, bool)>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    #[serde(default)]
    pub parent_id: Option<String>,
    pub key: String,
    pub task_id: String,
    pub project: String,
    pub kind: String,
    pub at: u64,
}
#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct QuotaWindow {
    pub bucket: String,
    pub label: String,
    pub remaining_percent: Option<f64>,
    pub duration_mins: Option<u64>,
    pub resets_at: Option<u64>,
}
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: u64,
    pub enabled: bool,
    pub source: String,
    pub message: String,
    pub tasks: Vec<Task>,
    pub notices: Vec<Notice>,
    pub quota: Vec<QuotaWindow>,
    pub quota_updated_at: Option<u64>,
    pub quota_error: Option<String>,
}
impl Default for Snapshot {
    fn default() -> Self {
        Self {
            revision: 0,
            enabled: false,
            source: "disabled".into(),
            message: "未开启任务跟随".into(),
            tasks: vec![],
            notices: vec![],
            quota: vec![],
            quota_updated_at: None,
            quota_error: None,
        }
    }
}

pub fn decode_quota(value: &Value) -> Vec<QuotaWindow> {
    let entries: Vec<(String, &Value)> = if let Some(map) = value
        .get("rateLimitsByLimitId")
        .and_then(Value::as_object)
        .filter(|m| !m.is_empty())
    {
        map.iter().take(8).map(|(k, v)| (label(k), v)).collect()
    } else {
        value
            .get("rateLimits")
            .map(|v| vec![("codex".into(), v)])
            .unwrap_or_default()
    };
    entries
        .into_iter()
        .flat_map(|(bucket, v)| {
            ["primary", "secondary"].into_iter().filter_map(move |key| {
                let w = v.get(key)?.as_object()?;
                let minutes = w
                    .get("windowDurationMins")
                    .and_then(Value::as_u64)
                    .filter(|v| *v > 0 && *v < 1_000_000);
                Some(QuotaWindow {
                    bucket: bucket.clone(),
                    label: match minutes {
                        Some(300) => "5小时".into(),
                        Some(10080) => "7天".into(),
                        Some(n) => format!("{n}分钟"),
                        None => "额度窗口".into(),
                    },
                    remaining_percent: w
                        .get("usedPercent")
                        .and_then(Value::as_f64)
                        .filter(|n| n.is_finite() && *n >= 0.)
                        .map(|n| 100. - n.min(100.)),
                    duration_mins: minutes,
                    resets_at: w.get("resetsAt").and_then(Value::as_u64),
                })
            })
        })
        .collect()
}
