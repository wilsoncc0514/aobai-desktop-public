mod jev;
mod settings;
mod skins;

use serde::{Deserialize, Serialize};
use settings::{DesktopSettings, load_from_path, save_to_path};
use std::sync::Mutex;
use tauri::{
    AppHandle, Emitter, Manager,
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    path::BaseDirectory,
    tray::TrayIconBuilder,
};
use tauri_plugin_autostart::MacosLauncher;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JevStatus {
    pub configured: bool,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JevTestResult {
    pub success: bool,
    pub latency_ms: u64,
    pub message: String,
}

static JEV_CREDENTIAL_GENERATION: Mutex<u64> = Mutex::new(0);

fn next_credential_generation() -> Result<u64, String> {
    let mut generation = JEV_CREDENTIAL_GENERATION
        .lock()
        .map_err(|_| "Jev 凭据操作不可用".to_owned())?;
    *generation = generation.wrapping_add(1);
    Ok(*generation)
}

fn with_current_credential_generation<T>(
    expected: u64,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let generation = JEV_CREDENTIAL_GENERATION
        .lock()
        .map_err(|_| "Jev 凭据操作不可用".to_owned())?;
    if *generation != expected {
        return Err("较新的 Jev 凭据操作已取消本次操作".into());
    }
    operation()
}

fn effective_jev_enabled(settings_enabled: bool, env_requested: bool, key_available: bool) -> bool {
    key_available && (settings_enabled || env_requested)
}

fn preserve_jev_enabled(
    mut submitted: DesktopSettings,
    current: &DesktopSettings,
) -> DesktopSettings {
    submitted.jev_enabled = current.jev_enabled;
    submitted
}

fn env_jev_requested() -> bool {
    std::env::var("AOBAI_BEHAVIOR_PROVIDER").as_deref() == Ok("jev")
}

fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .resolve("settings.json", BaseDirectory::AppConfig)
        .map_err(|error| format!("无法定位设置目录：{error}"))
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<DesktopSettings, String> {
    load_from_path(&settings_path(&app)?)
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: DesktopSettings) -> Result<(), String> {
    let _generation = JEV_CREDENTIAL_GENERATION
        .lock()
        .map_err(|_| "设置保存不可用".to_owned())?;
    let path = settings_path(&app)?;
    // Only the dedicated Jev commands may change this flag. A delayed UI save
    // must not restore an old provider choice.
    let settings = preserve_jev_enabled(settings, &load_from_path(&path)?);
    save_to_path(&path, &settings)
}

#[tauri::command]
fn scan_skins(app: AppHandle) -> Result<skins::SkinScanResult, String> {
    let result = skins::scan(&skins::skin_root()?);
    for skin in &result.skins {
        app.asset_protocol_scope()
            .allow_file(&skin.atlas_path)
            .map_err(|error| format!("无法授权皮肤图集：{error}"))?;
        if let Some(path) = &skin.atlas2x_path {
            app.asset_protocol_scope()
                .allow_file(path)
                .map_err(|error| format!("无法授权高清图集：{error}"))?;
        }
    }
    Ok(result)
}

#[tauri::command]
fn get_jev_status(app: AppHandle) -> Result<JevStatus, String> {
    let settings = load_settings(app)?;
    let configured = jev::has_api_key();
    let enabled = effective_jev_enabled(settings.jev_enabled, env_jev_requested(), configured);
    Ok(JevStatus {
        configured,
        enabled,
    })
}

#[tauri::command]
fn jev_set_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let generation = next_credential_generation()?;
    with_current_credential_generation(generation, || {
        let mut settings = load_settings(app.clone())?;
        if enabled && !jev::has_api_key() {
            return Err("未配置 API Key，无法启用 Jev 决策".into());
        }
        if !enabled && env_jev_requested() && jev::has_api_key() {
            return Err("开发环境变量正在启用 Jev；取消变量并重启后才能关闭".into());
        }
        settings.jev_enabled = enabled;
        save_to_path(&settings_path(&app)?, &settings)
    })
}

#[tauri::command]
async fn jev_verify_and_save_key(app: AppHandle, key: String) -> Result<JevTestResult, String> {
    let generation = next_credential_generation()?;
    let latency_ms = jev::verify_key(&key).await?;
    with_current_credential_generation(generation, || {
        let path = settings_path(&app)?;
        let mut settings = load_from_path(&path)?;
        jev::set_api_key(&key)?;
        settings.jev_enabled = true;
        save_to_path(&path, &settings)
            .map_err(|_| "API Key 已保存，但写入启用设置失败".to_owned())?;
        Ok(JevTestResult {
            success: true,
            latency_ms,
            message: "API Key 验证通过并已安全保存".into(),
        })
    })
}

#[tauri::command]
async fn jev_test_connection() -> Result<JevTestResult, String> {
    let latency_ms = jev::test_connection().await?;
    Ok(JevTestResult {
        success: true,
        latency_ms,
        message: "连接正常".into(),
    })
}

#[tauri::command]
fn jev_delete_key(app: AppHandle) -> Result<(), String> {
    let generation = next_credential_generation()?;
    with_current_credential_generation(generation, || {
        jev::delete_api_key()?;
        let mut settings = load_settings(app.clone())
            .map_err(|_| "系统凭据已删除，但读取启用设置失败".to_owned())?;
        settings.jev_enabled = false;
        save_to_path(&settings_path(&app)?, &settings)
            .map_err(|_| "系统凭据已删除，但写入启用设置失败".to_owned())
    })
}

#[tauri::command]
fn behavior_provider(app: AppHandle) -> Result<String, String> {
    if get_jev_status(app)?.enabled {
        Ok("jev".to_owned())
    } else {
        Ok("rule".to_owned())
    }
}

#[tauri::command]
async fn jev_decide(app: AppHandle, input: jev::JevInput) -> Result<String, String> {
    if behavior_provider(app)? != "jev" {
        return Err("Jev provider is disabled".into());
    }
    jev::decide(input).await
}

fn install_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示鳌拜", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "隐藏鳌拜", true, None::<&str>)?;
    let quiet = MenuItem::with_id(app, "mode-quiet", "安静", true, None::<&str>)?;
    let normal = MenuItem::with_id(app, "mode-normal", "普通", true, None::<&str>)?;
    let active = MenuItem::with_id(app, "mode-active", "活跃", true, None::<&str>)?;
    let behavior = Submenu::with_items(app, "行为", true, &[&quiet, &normal, &active])?;
    let layer_top = MenuItem::with_id(app, "layer-top", "置顶", true, None::<&str>)?;
    let layer_normal = MenuItem::with_id(app, "layer-normal", "普通", true, None::<&str>)?;
    let layer_bottom = MenuItem::with_id(app, "layer-bottom", "置底", true, None::<&str>)?;
    let layer = Submenu::with_items(
        app,
        "层级",
        true,
        &[&layer_top, &layer_normal, &layer_bottom],
    )?;
    let reset = MenuItem::with_id(app, "reset-position", "重置位置", true, None::<&str>)?;
    let window = Submenu::with_items(app, "窗口", true, &[&layer, &reset])?;
    let reload = MenuItem::with_id(app, "reload-skins", "重新扫描 skin", true, None::<&str>)?;
    let scanned = skins::skin_root()
        .map(|root| skins::scan(&root))
        .unwrap_or_else(|_| skins::SkinScanResult {
            root_path: String::new(),
            skins: Vec::new(),
            warnings: Vec::new(),
        });
    let skin_items = scanned
        .skins
        .iter()
        .map(|skin| {
            MenuItem::with_id(
                app,
                format!("skin:{}", skin.id),
                &skin.display_name,
                true,
                None::<&str>,
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut appearance_items: Vec<&dyn tauri::menu::IsMenuItem<_>> = skin_items
        .iter()
        .map(|item| item as &dyn tauri::menu::IsMenuItem<_>)
        .collect();
    appearance_items.push(&reload);
    let appearance = Submenu::with_items(app, "外观", true, &appearance_items)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &show,
            &hide,
            &appearance,
            &window,
            &behavior,
            &separator,
            &quit,
        ],
    )?;
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .icon_as_template(true)
        .tooltip("鳌拜·桌面宠物")
        .menu(&menu)
        .on_menu_event(|app, event| {
            let Some(window) = app.get_webview_window("main") else {
                eprintln!("tray event ignored: main window not found");
                return;
            };
            match event.id.as_ref() {
                "show" => {
                    if let Err(error) = window.show() {
                        eprintln!("failed to show main window: {error}");
                    }
                }
                "hide" => {
                    if let Err(error) = window.hide() {
                        eprintln!("failed to hide main window: {error}");
                    }
                }
                "mode-quiet" => {
                    if let Err(error) = window.emit("tray-mode", "quiet") {
                        eprintln!("failed to emit quiet mode: {error}");
                    }
                }
                "mode-normal" => {
                    if let Err(error) = window.emit("tray-mode", "normal") {
                        eprintln!("failed to emit normal mode: {error}");
                    }
                }
                "mode-active" => {
                    if let Err(error) = window.emit("tray-mode", "active") {
                        eprintln!("failed to emit active mode: {error}");
                    }
                }
                "layer-top" => {
                    if let Err(error) = window.emit("tray-layer", "top") {
                        eprintln!("failed to emit top layer: {error}");
                    }
                }
                "layer-normal" => {
                    if let Err(error) = window.emit("tray-layer", "normal") {
                        eprintln!("failed to emit normal layer: {error}");
                    }
                }
                "layer-bottom" => {
                    if let Err(error) = window.emit("tray-layer", "bottom") {
                        eprintln!("failed to emit bottom layer: {error}");
                    }
                }
                "reset-position" => {
                    if let Err(error) = window.center() {
                        eprintln!("failed to center main window: {error}");
                    }
                }
                "reload-skins" => {
                    if let Err(error) = window.emit("tray-reload-skins", ()) {
                        eprintln!("failed to request skin reload: {error}");
                    }
                }
                id if id.starts_with("skin:") => {
                    if let Err(error) = window.emit("tray-skin", &id[5..]) {
                        eprintln!("failed to switch tray skin: {error}");
                    }
                }
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            scan_skins,
            behavior_provider,
            jev_decide,
            get_jev_status,
            jev_set_enabled,
            jev_verify_and_save_key,
            jev_test_connection,
            jev_delete_key
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.handle()
                .set_activation_policy(tauri::ActivationPolicy::Accessory)?;
            install_tray(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("fatal error while running Aobai desktop pet");
}

#[cfg(test)]
mod provider_tests {
    use super::*;

    #[test]
    fn provider_requires_both_key_and_enabled_setting_or_development_override() {
        assert!(!effective_jev_enabled(false, false, false));
        assert!(!effective_jev_enabled(true, true, false));
        assert!(!effective_jev_enabled(false, false, true));
        assert!(effective_jev_enabled(true, false, true));
        assert!(effective_jev_enabled(false, true, true));
    }

    #[test]
    fn ordinary_settings_save_cannot_change_jev_flag() {
        let current = DesktopSettings {
            jev_enabled: true,
            ..DesktopSettings::default()
        };
        let submitted = DesktopSettings {
            mode: "quiet".into(),
            ..DesktopSettings::default()
        };
        let saved = preserve_jev_enabled(submitted, &current);
        assert!(saved.jev_enabled);
        assert_eq!(saved.mode, "quiet");
    }

    #[test]
    fn newer_credential_action_cancels_older_verified_request() {
        let old = next_credential_generation().unwrap();
        let _new = next_credential_generation().unwrap();
        let result = with_current_credential_generation(old, || -> Result<(), String> {
            panic!("stale request must not save a credential")
        });
        assert!(result.is_err());
    }
}
