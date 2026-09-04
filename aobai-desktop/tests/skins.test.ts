import { afterEach, describe, expect, it, vi } from "vitest";
import { preloadSkin, type SkinInfo } from "../src/skins/catalog";

const skin: SkinInfo = { id: "AllBuy", displayName: "鳌拜", atlasPath: "", atlasUrl: "standard", atlas2xUrl: "hires" };

function mockImages(highResolution: "valid" | "missing" | "wrong-size") {
  const requests: string[] = [];
  vi.stubGlobal("Image", class {
    src = "";
    naturalWidth = 1536;
    naturalHeight = 2288;
    async decode() {
      requests.push(this.src);
      if (this.src !== "hires") return;
      if (highResolution === "missing") throw new Error("missing");
      if (highResolution === "valid") { this.naturalWidth *= 2; this.naturalHeight *= 2; }
    }
  });
  return requests;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("optional high-density skin", () => {
  it("loads source detail at 2x for Retina", async () => {
    const requests = mockImages("valid");
    expect((await preloadSkin(skin, 2)).naturalWidth).toBe(3072);
    expect(requests).toEqual(["hires"]);
  });
  it.each(["missing", "wrong-size"] as const)("falls back when hires is %s", async (failure) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const requests = mockImages(failure);
    expect((await preloadSkin(skin, 2)).naturalWidth).toBe(1536);
    expect(requests).toEqual(["hires", "standard"]);
  });
  it("keeps old skins and 1x screens on the standard atlas", async () => {
    const requests = mockImages("valid");
    await preloadSkin(skin, 1);
    await preloadSkin({ ...skin, atlas2xUrl: undefined }, 2);
    expect(requests).toEqual(["standard", "standard"]);
  });
});
