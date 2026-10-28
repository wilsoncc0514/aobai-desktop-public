import { EMPTY_CODEX, PHASE_LABEL, noticeText, taskSummary, type CodexSnapshot } from "../codex/model";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { Menu } from "@tauri-apps/api/menu";
import { TrayIcon } from "@tauri-apps/api/tray";
import {
  PhysicalPosition,
  availableMonitors,
  currentMonitor,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { DEFAULT_SETTINGS, normalizeSettings, type DesktopSettings } from "../settings/schema";
import { contextMenuXOffset } from "./menuPlacement";
import { hasReachableArea } from "./windowPosition";

const WEB_STORAGE_KEY = "aobai-desktop-settings";
let previousContextMenu: Menu | undefined;
let previousTrayMenu: Menu | undefined;
let trayMenuChain: Promise<void> = Promise.resolve();
let pendingTrayUpdate: (() => Promise<void>) | undefined;

export interface JevStatus {
  readonly loading?: boolean;
  readonly configured: boolean;
  readonly enabled: boolean;
  readonly connected?: boolean;
  readonly credentialError?: boolean;
}

export interface JevTestResult {
  readonly success: boolean;
  readonly latencyMs: number;
  readonly message: string;
}

export type ContextMenuAction =
  | `mode:${DesktopSettings["mode"]}`
  | `layer:${DesktopSettings["windowLayer"]}`
  | "toggle-autostart"
  | "reset-position"
  | "hide"
  | "reload-skins"
  | `skin:${string}`
  | `motion:${string}`
  | "jev:toggle-enabled"
  | "jev:paste-key"
  | "jev:test-connection"
  | "jev:delete-key"
  | "codex:toggle" | `codex:open:${string}` | `codex:ack:${string}`;

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
  const visible = hasReachableArea(settings.position, size, await availableMonitors());
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

export async function focusPetWindow(): Promise<void> {
  if (!runningInTauri()) return;
  const window = getCurrentWindow();
  await window.show();
  await window.setFocus();
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

function buildTaskMenu(codex: CodexSnapshot, action: (id: ContextMenuAction) => () => void) {
  return {
      text: "Codex",
      items: [
        { text: "任务通知", checked: codex.enabled, id: "pet:codex:toggle", action: action("codex:toggle") },
        { text: codex.message, enabled: false },
        ...(codex.enabled ? [
          { text: taskSummary(codex), enabled: false },
          { text: `未读提醒 ${codex.notices.length}`, items: codex.notices.length ? codex.notices.slice(0, 12).map(n => ({ text: noticeText(n), items: [
            { text: "打开会话", id: `pet:codex:notice:${n.key}`, action: action(`codex:open:${n.taskId}`) },
            { text: "标为已读", id: `pet:codex:ack:${n.key}`, action: action(`codex:ack:${n.key}`) },
          ] })) : [{ text: "暂无未读提醒", enabled: false }] },
          { text: "最近任务", items: codex.tasks.length ? codex.tasks.slice(0, 16).map(t => ({
            text: `${t.parentId ? "↳ " : ""}${t.project} · ${PHASE_LABEL[t.phase]} · ${t.id.slice(-6)}`,
            id: `pet:codex:task:${t.id}`, action: action(`codex:open:${t.id}`),
          })) : [{ text: "最近没有可读取的任务", enabled: false }] },
        ] : []),
      ],
    };
}

export function buildPetContextMenuTree(codex: CodexSnapshot, action: (id: ContextMenuAction) => () => void) {
  return [buildTaskMenu(codex, action), { item: "Separator" as const },
    { text: "暂时隐藏", id: "pet:hide", action: action("hide") }];
}

export function buildContextMenuTree(
  settings: DesktopSettings,
  skins: readonly { id: string; displayName: string }[],
  jevStatus: JevStatus,
  action: (id: ContextMenuAction) => () => void,
  codex: CodexSnapshot = EMPTY_CODEX,
) {
  return [
    {
      text: "外观",
      items: [
        ...skins.map((skin) => ({
          text: skin.displayName,
          checked: skin.id === settings.selectedSkinId,
          id: `pet:skin:${skin.id}`, action: action(`skin:${skin.id}`),
        })),
        { item: "Separator" as const },
        { text: "重新扫描 skin", id: "pet:reload-skins", action: action("reload-skins") },
      ],
    },
    {
      text: "动作",
      items: [
        { text: "伸个懒腰", id: "pet:motion:review", action: action("motion:review") },
        { text: "舔爪梳毛", id: "pet:motion:waving", action: action("motion:waving") },
        { text: "舒适踩奶", id: "pet:motion:running", action: action("motion:running") },
        { text: "翻滚肚皮", id: "pet:motion:belly", action: action("motion:belly") },
        { text: "打个小盹", id: "pet:motion:sleep", action: action("motion:sleep") },
        { item: "Separator" as const },
        {
          text: "Jev",
          items: [
            {
              text: jevStatus.loading ? "状态：正在读取" : jevStatus.credentialError
                ? "状态：凭据读取失败"
                : !jevStatus.configured
                ? "状态：未配置"
                : jevStatus.connected
                  ? "状态：已连接"
                  : jevStatus.connected === false
                    ? "状态：连接失败"
                    : "状态：已配置，待验证",
              enabled: false,
            },
            {
              text: "使用 Jev 决策",
              checked: jevStatus.enabled,
              enabled: jevStatus.configured,
              id: "pet:jev:toggle-enabled", action: action("jev:toggle-enabled"),
            },
            {
              text: "从剪贴板粘贴 API Key",
              id: "pet:jev:paste-key", action: action("jev:paste-key"),
            },
            {
              text: "测试连接",
              enabled: jevStatus.configured || Boolean(jevStatus.credentialError),
              id: "pet:jev:test-connection", action: action("jev:test-connection"),
            },
            {
              text: "删除 API Key",
              enabled: jevStatus.configured,
              id: "pet:jev:delete-key", action: action("jev:delete-key"),
            },
          ],
        },
      ],
    },
    {
      text: "窗口",
      items: [
        {
          text: "层级",
          items: [
            { text: "置顶", checked: settings.windowLayer === "top", id: "pet:layer:top", action: action("layer:top") },
            { text: "普通", checked: settings.windowLayer === "normal", id: "pet:layer:normal", action: action("layer:normal") },
            { text: "置底", checked: settings.windowLayer === "bottom", id: "pet:layer:bottom", action: action("layer:bottom") },
          ],
        },
        { text: "重置位置", id: "pet:reset-position", action: action("reset-position") },
      ],
    },
    {
      text: "行为",
      items: [
        { text: "安静", checked: settings.mode === "quiet", id: "pet:mode:quiet", action: action("mode:quiet") },
        { text: "普通", checked: settings.mode === "normal", id: "pet:mode:normal", action: action("mode:normal") },
        { text: "活跃", checked: settings.mode === "active", id: "pet:mode:active", action: action("mode:active") },
        { item: "Separator" as const },
        {
          text: settings.autostart ? "关闭开机启动" : "开启开机启动",
          id: "pet:toggle-autostart", action: action("toggle-autostart"),
        },
      ],
    },
    buildTaskMenu(codex, action),
    { item: "Separator" as const },
    { text: "暂时隐藏", id: "pet:hide", action: action("hide") },
  ];
}

export function syncTrayContextMenu(
  settings: DesktopSettings,
  skins: readonly { id: string; displayName: string }[],
  jevStatus: JevStatus,
  onAction: (action: ContextMenuAction) => void,
  codex: CodexSnapshot = EMPTY_CODEX,
): Promise<void> {
  if (!runningInTauri()) return Promise.resolve();
  pendingTrayUpdate = async () => {
    const tray = await TrayIcon.getById("main");
    if (!tray) throw new Error("状态栏图标未就绪");
    const menu = await Menu.new({ id: "pet-tray-menu", items: [
      { id: "show", text: "显示鳌拜" },
      ...buildContextMenuTree(settings, skins, jevStatus, (id) => () => onAction(id), codex),
      { item: "Separator" },
      { id: "quit", text: "退出" },
    ] });
    try {
      await tray.setMenu(menu);
    } catch (error) {
      await menu.close();
      throw error;
    }
    const old = previousTrayMenu;
    previousTrayMenu = menu;
    await old?.close();
    // getById returns the registered resource itself; closing it removes the icon.
  };
  const update = trayMenuChain.then(async () => {
    const latest = pendingTrayUpdate;
    pendingTrayUpdate = undefined;
    await latest?.();
  });
  trayMenuChain = update.catch(() => undefined);
  return update;
}

export async function showPetContextMenu(
  onAction: (action: ContextMenuAction) => void,
  codex: CodexSnapshot = EMPTY_CODEX,
): Promise<boolean> {
  if (!runningInTauri()) return false;
  // popup holds native menu resources until dismissal. Serialize every menu mutation.
  const update = trayMenuChain.then(async () => {
    if (previousContextMenu) {
      await previousContextMenu.close().catch(() => undefined);
    }

    const action = (id: ContextMenuAction) => () => onAction(id);
    const menu = await Menu.new({
      id: "pet-context-menu",
      items: buildPetContextMenuTree(codex, action),
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
  });
  trayMenuChain = update.then(() => undefined, () => undefined);
  return update;
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

export async function getJevStatus(retryUnavailable = false): Promise<JevStatus> {
  if (!runningInTauri()) return { configured: false, enabled: false };
  return invoke<JevStatus>("get_jev_status", { retryUnavailable });
}

export async function setJevEnabled(enabled: boolean): Promise<void> {
  if (!runningInTauri()) return;
  await invoke("jev_set_enabled", { enabled });
}

export async function verifyAndSaveJevKey(key: string): Promise<JevTestResult> {
  if (!runningInTauri()) throw new Error("离线环境不可用");
  return invoke<JevTestResult>("jev_verify_and_save_key", { key });
}

export async function testJevConnection(): Promise<JevTestResult> {
  if (!runningInTauri()) throw new Error("离线环境不可用");
  return invoke<JevTestResult>("jev_test_connection");
}

export async function deleteJevKey(): Promise<void> {
  if (!runningInTauri()) return;
  await invoke("jev_delete_key");
}
