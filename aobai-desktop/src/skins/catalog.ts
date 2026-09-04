import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { BUILTIN_SKIN_ID } from "../settings/schema";

export interface SkinInfo {
  readonly id: string;
  readonly displayName: string;
  readonly atlasPath: string;
  readonly atlasUrl: string;
  readonly atlas2xUrl?: string;
}

interface NativeSkinInfo {
  readonly id: string;
  readonly displayName: string;
  readonly atlasPath: string;
  readonly atlas2xPath?: string | null;
}

interface NativeSkinScanResult {
  readonly rootPath: string;
  readonly skins: readonly NativeSkinInfo[];
  readonly warnings: readonly string[];
}

export const BUILTIN_SKIN: SkinInfo = Object.freeze({
  id: BUILTIN_SKIN_ID,
  displayName: "鳌拜",
  atlasPath: "",
  atlasUrl: "/builtin/aobai/spritesheet.webp",
  atlas2xUrl: "/builtin/aobai/spritesheet@2x.webp",
});

export interface SkinScanResult {
  readonly rootPath: string;
  readonly skins: readonly SkinInfo[];
  readonly warnings: readonly string[];
}

export async function scanSkins(): Promise<SkinScanResult> {
  if (!isTauri()) return { rootPath: "skin", skins: [BUILTIN_SKIN], warnings: [] };
  const result = await invoke<NativeSkinScanResult>("scan_skins");
  const skins = result.skins.map((skin) => ({
    ...skin,
    atlasUrl: convertFileSrc(skin.atlasPath),
    atlas2xUrl: skin.atlas2xPath ? convertFileSrc(skin.atlas2xPath) : undefined,
  }));
  return {
    rootPath: result.rootPath,
    skins: skins.some((skin) => skin.id === BUILTIN_SKIN.id) ? skins : [BUILTIN_SKIN, ...skins],
    warnings: result.warnings,
  };
}

async function loadAtlas(url: string, scale: number): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  if (image.naturalWidth !== 1536 * scale || image.naturalHeight !== 2288 * scale) {
    throw new Error(`图集尺寸无效：${image.naturalWidth}×${image.naturalHeight}`);
  }
  return image;
}

export async function preloadSkin(
  skin: SkinInfo,
  displayScale = window.devicePixelRatio,
): Promise<HTMLImageElement> {
  if (displayScale > 1 && skin.atlas2xUrl) {
    try {
      return await loadAtlas(skin.atlas2xUrl, 2);
    } catch (error) {
      console.warn("高清图集不可用，退回标准图集", error);
    }
  }
  return loadAtlas(skin.atlasUrl, 1);
}
