mod codex;
mod jev;
mod settings;
mod skins;

use serde::{Deserialize, Serialize};
use settings::{DesktopSettings, load_from_path, save_to_path};
use std::sync::Mutex;
use tauri::{
    AppHandle, Manager,
    menu::{Menu, MenuItem},
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

fn read_jev_status(app: AppHandle, retry_unavailable: Option<bool>) -> Result<JevStatus, String> {
    let settings = load_settings(app)?;
    if retry_unavailable.unwrap_or(false) {
        jev::retry_unavailable_credentials()?;
    }
    let configured = jev::has_api_key()?;
    let enabled = effective_jev_enabled(settings.jev_enabled, env_jev_requested(), configured);
    Ok(JevStatus {
        configured,
        enabled,
    })
}

#[tauri::command]
async fn get_jev_status(
    app: AppHandle,
    retry_unavailable: Option<bool>,
) -> Result<JevStatus, String> {
    // Keychain access can wait for OS authorization. Keep the GUI event loop free.
    tauri::async_runtime::spawn_blocking(move || read_jev_status(app, retry_unavailable))
        .await
        .map_err(|_| "Jev 状态读取失败".to_owned())?
}

#[tauri::command]
fn jev_set_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let generation = next_credential_generation()?;
    with_current_credential_generation(generation, || {
        let mut settings = load_settings(app.clone())?;
        if enabled && !jev::has_api_key()? {
            return Err("未配置 API Key，无法启用 Jev 决策".into());
        }
        if !enabled && env_jev_requested() && jev::has_api_key()? {
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
async fn behavior_provider(app: AppHandle) -> Result<String, String> {
    if get_jev_status(app, None).await?.enabled {
        Ok("jev".to_owned())
    } else {
        Ok("rule".to_owned())
    }
}

#[tauri::command]
async fn jev_decide(app: AppHandle, input: jev::JevInput) -> Result<String, String> {
    if behavior_provider(app).await? != "jev" {
        return Err("Jev provider is disabled".into());
    }
    jev::decide(input).await
}

#[tauri::command]
fn get_codex_status(service: tauri::State<'_, codex::Service>) -> codex::Snapshot {
    service.snapshot()
}
#[tauri::command]
fn codex_set_enabled(
    app: AppHandle,
    service: tauri::State<'_, codex::Service>,
    enabled: bool,
) -> Result<codex::Snapshot, String> {
    service.set_enabled(&app, enabled)
}
#[tauri::command]
fn codex_refresh(app: AppHandle, service: tauri::State<'_, codex::Service>) {
    service.refresh(&app);
}
#[tauri::command]
fn codex_acknowledge(
    app: AppHandle,
    service: tauri::State<'_, codex::Service>,
    key: String,
) -> Result<(), String> {
    service.acknowledge(&app, &key)
}
#[tauri::command]
async fn codex_open_task(
    app: AppHandle,
    service: tauri::State<'_, codex::Service>,
    id: String,
) -> Result<(), String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.open(&app, &id))
        .await
        .map_err(|_| "打开任务失败".to_owned())?
}

fn install_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示鳌拜", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "隐藏鳌拜", true, None::<&str>)?;
    // A minimal recovery menu is available before the webview has loaded.
    // The webview replaces it with the shared pet context menu and live checkmarks.
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &quit])?;
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
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
        if let Some(window) = app.get_webview_window("main")
            && let Err(error) = window.show()
        {
            eprintln!("failed to show existing main window: {error}");
        }
    }));
    builder
        .manage(codex::Service::default())
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
            jev_delete_key,
            get_codex_status,
            codex_set_enabled,
            codex_refresh,
            codex_acknowledge,
            codex_open_task
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.handle()
                .set_activation_policy(tauri::ActivationPolicy::Accessory)?;
            install_tray(app)?;
            if app
                .state::<codex::Service>()
                .configure(app.handle())
                .is_err()
            {
                eprintln!("Codex follow settings unavailable; monitoring remains disabled");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("fatal error while building Aobai desktop pet")
        .run(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                app.state::<codex::Service>().stop();
            }
        });
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
