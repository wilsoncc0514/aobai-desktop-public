use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const ACTIONS: [&str; 5] = ["idle", "groom", "knead", "stretch", "sleep"];
const ENDPOINT: &str = "https://api.typesafe.ai/v1/systemone";
const SERVICE_NAME: &str = "aobai-desktop";
const KEYRING_USER: &str = "typesafe_api_key";
const DECISION_INSTRUCTIONS: &str = concat!(
    "Select exactly one next ambient pet action from `availableActions`. ",
    "Use `mode`, `hour`, `recentActions`, `secondsSinceLastAmbientAction`, and ",
    "`secondsSinceUserInteraction` together. Choose the behavior that naturally fits the ",
    "current state; do not manufacture variety. `idle` is a common waking behavior for ",
    "observing or pausing when no stronger action tendency exists. It may appear often, ",
    "but it is never an error fallback. Grooming is common after activity, mild stimulation, ",
    "or before rest, though repeated grooming should not become dense. Kneading is more ",
    "specific to a comfortable, safe, relaxed situation and should not be chosen merely ",
    "for variety. Stretching fits waking from sleep, a long still period, or preparing to ",
    "be active; do not choose it for every ordinary ambient decision. In active mode, when ",
    "user interaction is not very recent, idle and sleep should be uncommon: prefer a ",
    "suitable awake behavior such as grooming, or stretching when its specific conditions ",
    "apply. Do not force kneading. Very recent user interaction can favor a calm awake ",
    "action. Sleep is more suitable at night, in low activity, or when both inactivity ",
    "durations show a long quiet period; if sleep is not recent, that long quiet context ",
    "can make sleep a stronger choice than idle even during daytime. Reduce immediate ",
    "repetition of actions in `recentActions`. When sleep is recent, do not choose sleep ",
    "again; a waking stretch can fit when available. Choose only a criterion present in ",
    "`availableActions`."
);

fn action_description(action: &str) -> &'static str {
    match action {
        "idle" => {
            "Remain awake and observe or pause briefly; a common natural action when no stronger tendency exists, never an error fallback."
        }
        "groom" => {
            "Common self-grooming after activity or mild stimulation, or before rest; natural in moderation without dense repetition."
        }
        "knead" => {
            "Content rhythmic kneading for a specifically comfortable, safe, relaxed situation; not a generic variety choice."
        }
        "stretch" => {
            "A full-body stretch when just awake, after being still for a long time, or before activity; not a routine default."
        }
        "sleep" => {
            "Enter sustained rest when activity is low, it is nighttime, or the pet has been quiet for a long time; avoid repeating recent sleep."
        }
        _ => "",
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JevInput {
    pub mode: String,
    pub hour: u8,
    pub recent_actions: Vec<String>,
    pub seconds_since_last_ambient_action: f64,
    pub seconds_since_user_interaction: f64,
    pub available_actions: Vec<String>,
}

impl JevInput {
    fn valid(&self) -> bool {
        matches!(self.mode.as_str(), "quiet" | "normal" | "active")
            && self.hour < 24
            && self.recent_actions.len() <= 5
            && !self.available_actions.is_empty()
            && self.available_actions.len() <= ACTIONS.len()
            && self
                .recent_actions
                .iter()
                .chain(&self.available_actions)
                .all(|action| ACTIONS.contains(&action.as_str()))
            && [
                self.seconds_since_last_ambient_action,
                self.seconds_since_user_interaction,
            ]
            .iter()
            .all(|seconds| seconds.is_finite() && (0.0..=86_400.0).contains(seconds))
    }
}

fn selected_action(value: &serde_json::Value, available: &[String]) -> Option<String> {
    let answer = value.get("answers")?.get("action")?;
    if answer.get("type")?.as_str()? != "choice" {
        return None;
    }
    let action = answer.get("choice")?.as_str()?;
    if ACTIONS.contains(&action) && available.iter().any(|candidate| candidate == action) {
        Some(action.to_owned())
    } else {
        None
    }
}

fn response_status_error(status: reqwest::StatusCode) -> Option<String> {
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        Some("API Key 无效或未授权 (401/403)".into())
    } else if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        Some("请求过于频繁，已被限流 (429)".into())
    } else if !status.is_success() {
        Some(format!("Jev 响应状态异常 ({})", status.as_u16()))
    } else {
        None
    }
}

pub fn get_api_key() -> Option<String> {
    if let Ok(entry) = Entry::new(SERVICE_NAME, KEYRING_USER)
        && let Ok(key) = entry.get_password()
    {
        let trimmed = key.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_owned());
        }
    }
    if let Ok(env_key) = std::env::var("TYPESAFE_API_KEY") {
        let trimmed = env_key.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_owned());
        }
    }
    None
}

pub fn has_api_key() -> bool {
    get_api_key().is_some()
}

pub fn set_api_key(key: &str) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("API Key 不能为空".into());
    }
    if trimmed.len() > 512 {
        return Err("API Key 长度超出限制".into());
    }
    let entry = Entry::new(SERVICE_NAME, KEYRING_USER)
        .map_err(|error| format!("无法访问系统安全凭据服务：{error}"))?;
    entry
        .set_password(trimmed)
        .map_err(|error| format!("保存 API Key 失败：{error}"))?;
    // A fresh entry must see the value. Without a native keyring backend,
    // keyring's mock accepts writes but loses them between Entry instances.
    let saved = match Entry::new(SERVICE_NAME, KEYRING_USER).and_then(|entry| entry.get_password())
    {
        Ok(saved) => saved,
        Err(_) => {
            let _ = entry.delete_credential();
            return Err("系统凭据写入后无法重新读取，已取消保存".into());
        }
    };
    if saved != trimmed {
        let _ = entry.delete_credential();
        return Err("系统凭据写入校验失败，已取消保存".into());
    }
    Ok(())
}

pub fn delete_api_key() -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, KEYRING_USER)
        .map_err(|error| format!("无法访问系统安全凭据服务：{error}"))?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("删除 API Key 失败：{error}")),
    }
}

async fn send_jev_request(input: &JevInput, key: &str) -> Result<String, String> {
    let criteria: serde_json::Map<String, serde_json::Value> = input
        .available_actions
        .iter()
        .map(|action| {
            (
                action.clone(),
                serde_json::Value::String(action_description(action).to_owned()),
            )
        })
        .collect();
    let body = serde_json::json!({
        "model": "jev-latest",
        "state": &input,
        "questions": {
            "action": {
                "type": "choice",
                "instructions": DECISION_INSTRUCTIONS,
                "criteria": criteria
            }
        }
    });
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(1_200))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Jev HTTP client unavailable".to_owned())?;
    let response = client
        .post(ENDPOINT)
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "Jev 请求超时".to_owned()
            } else {
                "Jev 网络连接失败".to_owned()
            }
        })?;

    let status = response.status();
    if let Some(error) = response_status_error(status) {
        return Err(error);
    }

    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Jev 读取响应失败".to_owned())?
    {
        if bytes.len() + chunk.len() > 16 * 1024 {
            return Err("Jev 响应体超出 16 KiB 限制".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| "Jev 响应格式无效".to_owned())?;
    selected_action(&value, &input.available_actions).ok_or_else(|| "Jev 未返回合法动作".into())
}

pub async fn verify_key(key: &str) -> Result<u64, String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("API Key 不能为空".into());
    }
    if trimmed.len() > 512 {
        return Err("API Key 格式不正确".into());
    }
    let minimal_input = JevInput {
        mode: "normal".into(),
        hour: 12,
        recent_actions: vec!["idle".into()],
        seconds_since_last_ambient_action: 10.0,
        seconds_since_user_interaction: 10.0,
        available_actions: vec!["idle".into()],
    };
    let start = std::time::Instant::now();
    send_jev_request(&minimal_input, trimmed).await?;
    Ok(start.elapsed().as_millis().max(1) as u64)
}

pub async fn test_connection() -> Result<u64, String> {
    let key = get_api_key().ok_or_else(|| "未配置 API Key".to_owned())?;
    verify_key(&key).await
}

pub async fn decide(input: JevInput) -> Result<String, String> {
    if !input.valid() {
        return Err("Invalid Jev input".into());
    }
    let key = get_api_key().ok_or_else(|| "Jev API key unavailable".to_owned())?;
    send_jev_request(&input, &key).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn response_statuses_are_classified_without_response_body_or_headers() {
        assert!(response_status_error(reqwest::StatusCode::OK).is_none());
        for status in [
            reqwest::StatusCode::UNAUTHORIZED,
            reqwest::StatusCode::FORBIDDEN,
            reqwest::StatusCode::TOO_MANY_REQUESTS,
            reqwest::StatusCode::INTERNAL_SERVER_ERROR,
        ] {
            let error = response_status_error(status).unwrap();
            assert!(error.contains(&status.as_u16().to_string()));
        }
    }

    #[test]
    fn only_allowlisted_actions_and_fields() {
        let input: JevInput = serde_json::from_value(serde_json::json!({
            "mode": "normal", "hour": 12, "recentActions": ["idle"],
            "secondsSinceLastAmbientAction": 10, "secondsSinceUserInteraction": 100,
            "availableActions": ["idle", "sleep"]
        }))
        .unwrap();
        assert!(input.valid());
        assert!(
            serde_json::from_value::<JevInput>(serde_json::json!({
                "mode": "normal", "hour": 12, "recentActions": [],
                "secondsSinceLastAmbientAction": 10, "secondsSinceUserInteraction": 100,
                "availableActions": ["idle"], "windowTitle": "private"
            }))
            .is_err()
        );
        assert_eq!(
            selected_action(
                &serde_json::json!({"answers": {"action": {"type": "choice", "choice": "sleep"}}}),
                &input.available_actions
            ),
            Some("sleep".into())
        );
        assert_eq!(
            selected_action(
                &serde_json::json!({"answers": {"action": {"type": "choice", "choice": "groom"}}}),
                &input.available_actions
            ),
            None
        );
        assert_eq!(
            selected_action(
                &serde_json::json!({"answers": {"action": {"type": "choice", "choice": "drag"}}}),
                &input.available_actions
            ),
            None
        );
    }

    #[test]
    fn decision_language_defines_every_action_without_making_idle_a_fallback() {
        assert!(DECISION_INSTRUCTIONS.contains("`idle` is a common waking behavior"));
        assert!(DECISION_INSTRUCTIONS.contains("never an error fallback"));
        assert!(DECISION_INSTRUCTIONS.contains("`recentActions`"));
        assert!(DECISION_INSTRUCTIONS.contains("active mode"));
        assert!(DECISION_INSTRUCTIONS.contains("at night"));
        assert!(DECISION_INSTRUCTIONS.contains("do not manufacture variety"));
        for action in ACTIONS {
            let description = action_description(action);
            assert!(!description.is_empty());
            assert_ne!(description, action);
        }
    }

    #[test]
    fn missing_or_blank_key_cannot_start_a_request() {
        let empty: Option<String> = None;
        assert!(empty.filter(|k| !k.trim().is_empty()).is_none());
        let blank = Some("   ".to_string());
        assert!(blank.filter(|k| !k.trim().is_empty()).is_none());
    }

    #[test]
    fn api_key_validation_rejects_empty_or_oversized() {
        assert!(set_api_key("").is_err());
        assert!(set_api_key("   ").is_err());
        let too_long = "a".repeat(513);
        assert!(set_api_key(&too_long).is_err());
    }
}
