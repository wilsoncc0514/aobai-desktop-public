import { invoke, isTauri } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { Menu } from "@tauri-apps/api/menu";
import {
  PhysicalPosition,
  availableMonitors,
  currentMonitor,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { DEFAULT_SETTINGS, normalizeSettings, type DesktopSettings } from "../settings/schema";
import { contextMenuXOffset } from "./menuPlacement";

const WEB_STORAGE_KEY = "aobai-desktop-settings";
let previousContextMenu: Menu | undefined;

export type ContextMenuAction =
  | `mode:${DesktopSettings["mode"]}`
  | `layer:${DesktopSettings["windowLayer"]}`
  | "toggle-autostart"
  | "reset-position"
  | "hide"
  | "reload-skins"
  | `skin:${string}`;

function runningInTauri(): boolean {
  return isTauri();
}

export async function loadSettings(): Promise<DesktopSettings> {
  if (runningInTauri()) {
    return normalizeSettings(await invoke<unknown>("load_settings"));
  }
  const saved = localStorage.getItem(WEB_STORAGE_KEY);
  return saved ? normalizeSettings(JSON.parse(saved)) : DEFAULT_SETTINGS;
}

export async function saveSettings(settings: DesktopSettings): Promise<void> {
  const normalized = normalizeSettings(settings);
  if (runningInTauri()) {
    await invoke("save_settings", { settings: normalized });
    return;
  }
  localStorage.setItem(WEB_STORAGE_KEY, JSON.stringify(normalized));
}

export async function restoreWindowPosition(settings: DesktopSettings): Promise<void> {
  if (!runningInTauri() || settings.position === null) return;
  const window = getCurrentWindow();
  await window.setPosition(
    new PhysicalPosition(settings.position.x, settings.position.y),
  );
  const size = await window.outerSize();
  const visible = (await availableMonitors()).some((monitor) =>
    settings.position!.x + size.width > monitor.position.x &&
    settings.position!.x < monitor.position.x + monitor.size.width &&
    settings.position!.y + size.height > monitor.position.y &&
    settings.position!.y < monitor.position.y + monitor.size.height
  );
  if (!visible) await window.center();
}

export async function onWindowMoved(
  handler: (position: { x: number; y: number }) => void,
): Promise<UnlistenFn> {
  if (!runningInTauri()) return () => undefined;
  return getCurrentWindow().onMoved(({ payload }) => handler(payload));
}

export async function getWindowPosition(): Promise<{ x: number; y: number }> {
  if (!runningInTauri()) return { x: window.screenX, y: window.screenY };
  const position = await getCurrentWindow().outerPosition();
  return { x: position.x, y: position.y };
}

export async function moveWindowTo(position: { x: number; y: number }): Promise<void> {
  if (runningInTauri()) {
    await getCurrentWindow().setPosition(new PhysicalPosition(position.x, position.y));
  }
}

export async function startWindowDrag(): Promise<void> {
  if (runningInTauri()) await getCurrentWindow().startDragging();
}

export async function hideWindow(): Promise<void> {
  if (runningInTauri()) await getCurrentWindow().hide();
}

export async function centerWindow(): Promise<void> {
  if (runningInTauri()) await getCurrentWindow().center();
}

export async function applyWindowLayer(layer: DesktopSettings["windowLayer"]): Promise<void> {
  if (!runningInTauri()) return;
  const window = getCurrentWindow();
  await window.setAlwaysOnTop(false);
  await window.setAlwaysOnBottom(false);
  if (layer === "top") await window.setAlwaysOnTop(true);
  if (layer === "bottom") await window.setAlwaysOnBottom(true);
}

export async function showPetContextMenu(
  settings: DesktopSettings,
  skins: readonly { id: string; displayName: string }[],
  onAction: (action: ContextMenuAction) => void,
): Promise<boolean> {
  if (!runningInTauri()) return false;

  if (previousContextMenu) {
    await previousContextMenu.close().catch(() => undefined);
  }

  const action = (id: ContextMenuAction) => () => onAction(id);
  const menu = await Menu.new({
    items: [
      {
        text: "外观",
        items: [
          ...skins.map((skin) => ({
            text: skin.displayName,
            checked: skin.id === settings.selectedSkinId,
            action: action(`skin:${skin.id}`),
          })),
          { item: "Separator" as const },
          { text: "重新扫描 skin", action: action("reload-skins") },
        ],
      },
      {
        text: "窗口",
        items: [
          {
            text: "层级",
            items: [
              { text: "置顶", checked: settings.windowLayer === "top", action: action("layer:top") },
              { text: "普通", checked: settings.windowLayer === "normal", action: action("layer:normal") },
              { text: "置底", checked: settings.windowLayer === "bottom", action: action("layer:bottom") },
            ],
          },
          { text: "重置位置", action: action("reset-position") },
        ],
      },
      {
        text: "行为",
        items: [
          { text: "安静", checked: settings.mode === "quiet", action: action("mode:quiet") },
          { text: "普通", checked: settings.mode === "normal", action: action("mode:normal") },
          { text: "活跃", checked: settings.mode === "active", action: action("mode:active") },
          { item: "Separator" },
          {
            text: settings.autostart ? "关闭开机启动" : "开启开机启动",
            action: action("toggle-autostart"),
          },
        ],
      },
      { item: "Separator" },
      { text: "暂时隐藏", action: action("hide") },
    ],
  });
  previousContextMenu = menu;

  const window = getCurrentWindow();
  const [position, size, monitor] = await Promise.all([
    window.outerPosition(),
    window.outerSize(),
    currentMonitor(),
  ]);
  const monitorBounds = monitor
    ? { x: monitor.position.x, y: monitor.position.y, width: monitor.size.width, height: monitor.size.height }
    : { x: position.x, y: position.y, width: size.width + 460, height: size.height };
  const x = contextMenuXOffset(
    { x: position.x, y: position.y, width: size.width, height: size.height },
    monitorBounds,
    monitor?.scaleFactor ?? 1,
  );
  await menu.popup(new PhysicalPosition(x, 0), window);
  return true;
}

export async function listenForTraySkinReload(handler: () => void): Promise<UnlistenFn> {
  if (!runningInTauri()) return () => undefined;
  return getCurrentWindow().listen("tray-reload-skins", handler);
}

export async function listenForTraySkin(handler: (id: string) => void): Promise<UnlistenFn> {
  if (!runningInTauri()) return () => undefined;
  return getCurrentWindow().listen<string>("tray-skin", ({ payload }) => handler(payload));
}

export async function listenForTrayMode(
  handler: (mode: DesktopSettings["mode"]) => void,
): Promise<UnlistenFn> {
  if (!runningInTauri()) return () => undefined;
  return getCurrentWindow().listen<DesktopSettings["mode"]>("tray-mode", ({ payload }) => {
    handler(payload);
  });
}

export async function listenForTrayLayer(
  handler: (layer: DesktopSettings["windowLayer"]) => void,
): Promise<UnlistenFn> {
  if (!runningInTauri()) return () => undefined;
  return getCurrentWindow().listen<DesktopSettings["windowLayer"]>("tray-layer", ({ payload }) => {
    handler(payload);
  });
}

export async function getAutostartEnabled(): Promise<boolean> {
  return runningInTauri() ? isEnabled() : false;
}

export async function setAutostartEnabled(enabled: boolean): Promise<void> {
  if (!runningInTauri()) return;
  if (enabled) await enable();
  else await disable();
}
