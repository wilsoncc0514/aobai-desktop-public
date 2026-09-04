mod settings;
mod skins;

use settings::{DesktopSettings, load_from_path, save_to_path};
use tauri::{
    AppHandle, Emitter, Manager,
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    path::BaseDirectory,
    tray::TrayIconBuilder,
};
use tauri_plugin_autostart::MacosLauncher;

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
    save_to_path(&settings_path(&app)?, &settings)
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
            scan_skins
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
