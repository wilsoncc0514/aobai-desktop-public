import { describe, expect, it } from "vitest";
import { BUILTIN_SKIN_ID, DEFAULT_SETTINGS, normalizeSettings } from "../src/settings/schema";

describe("settings schema", () => {
  it("accepts the current settings format", () => {
    expect(normalizeSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it("rejects unknown future versions", () => {
    expect(() => normalizeSettings({ ...DEFAULT_SETTINGS, version: 6 })).toThrow(
      "不支持的设置版本",
    );
  });

  it("migrates version 1 settings to the default top layer", () => {
    expect(
      normalizeSettings({
        version: 1,
        mode: "quiet",
        autostart: true,
        position: { x: 12, y: 34 },
      }),
    ).toEqual({
      version: 5,
      mode: "quiet",
      windowLayer: "top",
      autostart: true,
      position: { x: 12, y: 34 },
      selectedSkinId: BUILTIN_SKIN_ID,
      jevEnabled: false,
    });
  });

  it("migrates version 4 settings to version 5 with jevEnabled: false", () => {
    expect(
      normalizeSettings({
        version: 4,
        mode: "active",
        windowLayer: "normal",
        autostart: true,
        position: { x: 50, y: 50 },
        selectedSkinId: "custom-skin",
      }),
    ).toEqual({
      version: 5,
      mode: "active",
      windowLayer: "normal",
      autostart: true,
      position: { x: 50, y: 50 },
      selectedSkinId: "custom-skin",
      jevEnabled: false,
    });
  });

  it("migrates version 2 settings to the built-in skin", () => {
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, version: 2, selectedSkinId: undefined }))
      .toEqual(DEFAULT_SETTINGS);
  });

  it("migrates the version 3 built-in skin id without changing custom ids", () => {
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, version: 3, selectedSkinId: "aobai" }))
      .toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, version: 3, selectedSkinId: "custom-cat" }))
      .toEqual({ ...DEFAULT_SETTINGS, selectedSkinId: "custom-cat" });
  });

  it("rejects unknown window layers", () => {
    expect(() =>
      normalizeSettings({ ...DEFAULT_SETTINGS, windowLayer: "floating" }),
    ).toThrow("窗口层级");
  });

  it("rejects unsafe positions", () => {
    expect(() =>
      normalizeSettings({ ...DEFAULT_SETTINGS, position: { x: 900_000, y: 0 } }),
    ).toThrow("窗口位置");
  });
});
