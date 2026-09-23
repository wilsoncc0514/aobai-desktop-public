use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

pub const SETTINGS_VERSION: u8 = 5;
pub const BUILTIN_SKIN_ID: &str = "AllBuy";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowPosition {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum WindowLayer {
    #[default]
    Top,
    Normal,
    Bottom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSettings {
    pub version: u8,
    pub mode: String,
    pub window_layer: WindowLayer,
    pub autostart: bool,
    pub position: Option<WindowPosition>,
    pub selected_skin_id: String,
    #[serde(default)]
    pub jev_enabled: bool,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            mode: "normal".to_owned(),
            window_layer: WindowLayer::Top,
            autostart: false,
            position: None,
            selected_skin_id: BUILTIN_SKIN_ID.to_owned(),
            jev_enabled: false,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VersionOneSettings {
    version: u8,
    mode: String,
    autostart: bool,
    position: Option<WindowPosition>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VersionTwoSettings {
    mode: String,
    window_layer: WindowLayer,
    autostart: bool,
    position: Option<WindowPosition>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VersionThreeSettings {
    mode: String,
    window_layer: WindowLayer,
    autostart: bool,
    position: Option<WindowPosition>,
    selected_skin_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VersionFourSettings {
    mode: String,
    window_layer: WindowLayer,
    autostart: bool,
    position: Option<WindowPosition>,
    selected_skin_id: String,
}

impl From<VersionOneSettings> for DesktopSettings {
    fn from(value: VersionOneSettings) -> Self {
        debug_assert_eq!(value.version, 1);
        Self {
            version: SETTINGS_VERSION,
            mode: value.mode,
            window_layer: WindowLayer::Top,
            autostart: value.autostart,
            position: value.position,
            selected_skin_id: BUILTIN_SKIN_ID.to_owned(),
            jev_enabled: false,
        }
    }
}

impl DesktopSettings {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != SETTINGS_VERSION {
            return Err(format!("不支持的设置版本：{}", self.version));
        }
        if !matches!(self.mode.as_str(), "quiet" | "normal" | "active") {
            return Err("活动模式无效".to_owned());
        }
        if let Some(position) = &self.position
            && (position.x.abs() > 100_000 || position.y.abs() > 100_000)
        {
            return Err("窗口位置无效".to_owned());
        }
        if self.selected_skin_id.is_empty() || self.selected_skin_id.len() > 48 {
            return Err("皮肤 id 无效".to_owned());
        }
        Ok(())
    }
}

pub fn load_from_path(path: &Path) -> Result<DesktopSettings, String> {
    match fs::read(path) {
        Ok(bytes) => {
            let value: serde_json::Value = serde_json::from_slice(&bytes)
                .map_err(|error| format!("设置文件无法解析：{error}"))?;
            let version = value
                .get("version")
                .and_then(serde_json::Value::as_u64)
                .ok_or_else(|| "设置文件缺少有效版本".to_owned())?;
            let settings = match version {
                1 => serde_json::from_value::<VersionOneSettings>(value)
                    .map(DesktopSettings::from)
                    .map_err(|error| format!("旧版设置无法迁移：{error}"))?,
                2 => serde_json::from_value::<VersionTwoSettings>(value)
                    .map(|value| DesktopSettings {
                        version: SETTINGS_VERSION,
                        mode: value.mode,
                        window_layer: value.window_layer,
                        autostart: value.autostart,
                        position: value.position,
                        selected_skin_id: BUILTIN_SKIN_ID.to_owned(),
                        jev_enabled: false,
                    })
                    .map_err(|error| format!("旧版设置无法迁移：{error}"))?,
                3 => serde_json::from_value::<VersionThreeSettings>(value)
                    .map(|value| DesktopSettings {
                        version: SETTINGS_VERSION,
                        mode: value.mode,
                        window_layer: value.window_layer,
                        autostart: value.autostart,
                        position: value.position,
                        selected_skin_id: if value.selected_skin_id == "aobai" {
                            BUILTIN_SKIN_ID.to_owned()
                        } else {
                            value.selected_skin_id
                        },
                        jev_enabled: false,
                    })
                    .map_err(|error| format!("旧版设置无法迁移：{error}"))?,
                4 => serde_json::from_value::<VersionFourSettings>(value)
                    .map(|value| DesktopSettings {
                        version: SETTINGS_VERSION,
                        mode: value.mode,
                        window_layer: value.window_layer,
                        autostart: value.autostart,
                        position: value.position,
                        selected_skin_id: value.selected_skin_id,
                        jev_enabled: false,
                    })
                    .map_err(|error| format!("旧版设置无法迁移：{error}"))?,
                version if version == u64::from(SETTINGS_VERSION) => {
                    serde_json::from_value::<DesktopSettings>(value)
                        .map_err(|error| format!("设置文件无法解析：{error}"))?
                }
                _ => return Err(format!("不支持的设置版本：{version}")),
            };
            settings.validate()?;
            Ok(settings)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(DesktopSettings::default())
        }
        Err(error) => Err(format!("设置文件无法读取：{error}")),
    }
}

pub fn save_to_path(path: &Path, settings: &DesktopSettings) -> Result<(), String> {
    settings.validate()?;
    let parent = path
        .parent()
        .ok_or_else(|| "设置路径缺少父目录".to_owned())?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建设置目录：{error}"))?;
    backup_legacy_settings(path)?;
    backup_invalid_settings(path)?;
    let temporary = path.with_extension("json.tmp");
    let bytes =
        serde_json::to_vec_pretty(settings).map_err(|error| format!("设置无法序列化：{error}"))?;
    fs::write(&temporary, bytes).map_err(|error| format!("临时设置无法写入：{error}"))?;
    fs::rename(&temporary, path).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        format!("设置无法原子替换：{error}")
    })
}

fn backup_legacy_settings(path: &Path) -> Result<(), String> {
    let Ok(bytes) = fs::read(path) else {
        return Ok(());
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return Ok(());
    };
    let Some(version @ (1..=4)) = value.get("version").and_then(serde_json::Value::as_u64) else {
        return Ok(());
    };
    let backup = path.with_extension(format!("v{version}-backup.json"));
    if !backup.exists() {
        fs::copy(path, &backup).map_err(|error| format!("旧版设置无法备份：{error}"))?;
    }
    Ok(())
}

fn backup_invalid_settings(path: &Path) -> Result<(), String> {
    if !path.exists() || load_from_path(path).is_ok() {
        return Ok(());
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("无法生成损坏设置备份时间：{error}"))?
        .as_secs();
    let backup = path.with_extension(format!("invalid-{timestamp}.json"));
    fs::copy(path, &backup).map_err(|error| format!("损坏设置无法备份：{error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings_round_trip() {
        let directory = tempfile::tempdir().expect("create temp directory");
        let path = directory.path().join("settings.json");
        let settings = DesktopSettings::default();
        save_to_path(&path, &settings).expect("save settings");
        assert_eq!(load_from_path(&path).expect("load settings"), settings);
    }

    #[test]
    fn corrupt_settings_are_reported_without_overwrite() {
        let directory = tempfile::tempdir().expect("create temp directory");
        let path = directory.path().join("settings.json");
        fs::write(&path, b"not-json").expect("write corrupt settings");
        assert!(load_from_path(&path).unwrap_err().contains("无法解析"));
        assert_eq!(fs::read(&path).expect("read original"), b"not-json");
    }

    #[test]
    fn corrupt_settings_are_backed_up_before_replacement() {
        let directory = tempfile::tempdir().expect("create temp directory");
        let path = directory.path().join("settings.json");
        fs::write(&path, b"not-json").expect("write corrupt settings");

        save_to_path(&path, &DesktopSettings::default()).expect("replace corrupt settings");

        assert_eq!(
            load_from_path(&path).expect("load replacement"),
            DesktopSettings::default()
        );
        let backup = fs::read_dir(directory.path())
            .expect("list settings directory")
            .filter_map(Result::ok)
            .find(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("settings.invalid-")
            })
            .expect("find invalid settings backup");
        assert_eq!(fs::read(backup.path()).expect("read backup"), b"not-json");
    }

    #[test]
    fn future_versions_are_rejected() {
        let settings = DesktopSettings {
            version: SETTINGS_VERSION + 1,
            ..DesktopSettings::default()
        };
        assert!(settings.validate().unwrap_err().contains("不支持"));
    }

    #[test]
    fn version_one_settings_are_migrated_and_backed_up_on_save() {
        let directory = tempfile::tempdir().expect("create temp directory");
        let path = directory.path().join("settings.json");
        let legacy = br#"{
          "version": 1,
          "mode": "active",
          "autostart": true,
          "position": { "x": 25, "y": 40 }
        }"#;
        fs::write(&path, legacy).expect("write legacy settings");

        let migrated = load_from_path(&path).expect("migrate legacy settings");
        assert_eq!(migrated.version, SETTINGS_VERSION);
        assert_eq!(migrated.window_layer, WindowLayer::Top);
        assert_eq!(migrated.mode, "active");
        save_to_path(&path, &migrated).expect("save migrated settings");

        assert_eq!(
            fs::read(path.with_extension("v1-backup.json")).expect("read migration backup"),
            legacy
        );
    }

    #[test]
    fn version_two_settings_add_the_default_skin_and_are_backed_up() {
        let directory = tempfile::tempdir().expect("create temp directory");
        let path = directory.path().join("settings.json");
        let legacy = br#"{
          "version": 2,
          "mode": "normal",
          "windowLayer": "bottom",
          "autostart": false,
          "position": null
        }"#;
        fs::write(&path, legacy).expect("write version two settings");

        let migrated = load_from_path(&path).expect("migrate version two settings");
        assert_eq!(migrated.selected_skin_id, BUILTIN_SKIN_ID);
        assert_eq!(migrated.window_layer, WindowLayer::Bottom);
        save_to_path(&path, &migrated).expect("save migrated settings");

        assert_eq!(
            fs::read(path.with_extension("v2-backup.json")).expect("read migration backup"),
            legacy
        );
    }

    #[test]
    fn version_three_builtin_id_is_migrated_and_backed_up() {
        let directory = tempfile::tempdir().expect("create temp directory");
        let path = directory.path().join("settings.json");
        let legacy = br#"{
          "version": 3,
          "mode": "normal",
          "windowLayer": "top",
          "autostart": false,
          "position": null,
          "selectedSkinId": "aobai"
        }"#;
        fs::write(&path, legacy).expect("write version three settings");

        let migrated = load_from_path(&path).expect("migrate version three settings");
        assert_eq!(migrated.selected_skin_id, BUILTIN_SKIN_ID);
        save_to_path(&path, &migrated).expect("save migrated settings");

        assert_eq!(
            fs::read(path.with_extension("v3-backup.json")).expect("read migration backup"),
            legacy
        );
    }

    #[test]
    fn version_four_settings_are_migrated_and_backed_up() {
        let directory = tempfile::tempdir().expect("create temp directory");
        let path = directory.path().join("settings.json");
        let legacy = br#"{
          "version": 4,
          "mode": "quiet",
          "windowLayer": "normal",
          "autostart": true,
          "position": { "x": 100, "y": 200 },
          "selectedSkinId": "custom_skin"
        }"#;
        fs::write(&path, legacy).expect("write version four settings");

        let migrated = load_from_path(&path).expect("migrate version four settings");
        assert_eq!(migrated.version, SETTINGS_VERSION);
        assert_eq!(migrated.mode, "quiet");
        assert_eq!(migrated.window_layer, WindowLayer::Normal);
        assert_eq!(migrated.selected_skin_id, "custom_skin");
        assert!(!migrated.jev_enabled);
        save_to_path(&path, &migrated).expect("save migrated settings");

        assert_eq!(
            fs::read(path.with_extension("v4-backup.json")).expect("read migration backup"),
            legacy
        );
    }
}
