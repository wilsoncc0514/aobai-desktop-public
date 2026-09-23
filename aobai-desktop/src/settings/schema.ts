export const SETTINGS_VERSION = 5 as const;
export const BUILTIN_SKIN_ID = "AllBuy" as const;
export const ACTIVITY_MODES = ["quiet", "normal", "active"] as const;
export const WINDOW_LAYERS = ["top", "normal", "bottom"] as const;

export type ActivityMode = (typeof ACTIVITY_MODES)[number];
export type WindowLayer = (typeof WINDOW_LAYERS)[number];

export interface WindowPosition {
  readonly x: number;
  readonly y: number;
}

export interface DesktopSettings {
  readonly version: typeof SETTINGS_VERSION;
  readonly mode: ActivityMode;
  readonly windowLayer: WindowLayer;
  readonly autostart: boolean;
  readonly position: WindowPosition | null;
  readonly selectedSkinId: string;
  readonly jevEnabled: boolean;
}

export const DEFAULT_SETTINGS: DesktopSettings = Object.freeze({
  version: SETTINGS_VERSION,
  mode: "normal",
  windowLayer: "top",
  autostart: false,
  position: null,
  selectedSkinId: BUILTIN_SKIN_ID,
  jevEnabled: false,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPosition(value: unknown): value is WindowPosition {
  if (!isRecord(value)) return false;
  return (
    Number.isInteger(value.x) &&
    Number.isInteger(value.y) &&
    Math.abs(value.x as number) <= 100_000 &&
    Math.abs(value.y as number) <= 100_000
  );
}

export function normalizeSettings(value: unknown): DesktopSettings {
  if (!isRecord(value)) throw new Error("设置文件不是有效对象");
  if (![1, 2, 3, 4, SETTINGS_VERSION].includes(value.version as number)) {
    throw new Error(`不支持的设置版本：${String(value.version)}`);
  }
  if (!ACTIVITY_MODES.includes(value.mode as ActivityMode)) {
    throw new Error("设置中的活动模式无效");
  }
  if (typeof value.autostart !== "boolean") {
    throw new Error("设置中的开机启动值无效");
  }
  if (value.position !== null && !isPosition(value.position)) {
    throw new Error("设置中的窗口位置无效");
  }
  const windowLayer = value.version === 1 ? "top" : value.windowLayer;
  if (!WINDOW_LAYERS.includes(windowLayer as WindowLayer)) {
    throw new Error("设置中的窗口层级无效");
  }
  return {
    version: SETTINGS_VERSION,
    mode: value.mode as ActivityMode,
    windowLayer: windowLayer as WindowLayer,
    autostart: value.autostart,
    position: value.position as WindowPosition | null,
    selectedSkinId:
      (value.version === 3 || value.version === 4 || value.version === SETTINGS_VERSION) &&
      typeof value.selectedSkinId === "string"
        ? value.selectedSkinId === "aobai"
          ? BUILTIN_SKIN_ID
          : value.selectedSkinId
        : BUILTIN_SKIN_ID,
    jevEnabled: typeof value.jevEnabled === "boolean" ? value.jevEnabled : false,
  };
}
