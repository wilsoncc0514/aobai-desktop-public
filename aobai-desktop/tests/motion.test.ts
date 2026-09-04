import { afterEach, describe, expect, it, vi } from "vitest";
import { MotionPlayer, type MotionLibrary } from "../src/animation/motion";
import { loadBuiltinMotions, validateMotionManifest } from "../src/animation/motionAssets";

const library: MotionLibrary = {
  idle: { durations: [100, 200], loop: true },
  belly: { durations: [100, 100, 100, 100, 100, 100], heldLoop: [2, 3] },
  waving: { durations: [100, 500, 100] },
};

describe("single-owner motion controller", () => {
  it("plays entry, holds belly without directional running, then finishes recovery", () => {
    const player = new MotionPlayer(library);
    player.press();
    const seen = [];
    for (let i = 0; i < 8; i++) { seen.push(player.snapshot.frame); player.advance(); }
    expect(seen).toEqual([0, 1, 2, 3, 2, 3, 2, 3]);
    expect(player.snapshot.action).toBe("belly");
    player.release();
    for (let i = 0; i < 4; i++) player.advance();
    expect(player.snapshot.action).toBe("idle");
  });
  it("short press still shows one complete roll, and repeated press does not restart it", () => {
    const player = new MotionPlayer(library);
    player.press(); player.advance(); player.press(); player.release();
    expect(player.snapshot.frame).toBe(1);
    for (let i = 0; i < 5; i++) player.advance();
    expect(player.snapshot.action).toBe("idle");
  });
  it("finishes the visible action before queued petting, without accumulating a queue", () => {
    const player = new MotionPlayer(library);
    player.request("waving"); player.advance(); player.press();
    player.request("running-left"); player.request("waving");
    expect(player.snapshot.action).toBe("waving");
    expect(player.snapshot.duration).toBeLessThanOrEqual(120);
    player.advance(); player.advance();
    expect(player.snapshot.action).toBe("belly");
  });
  it("reset clears held state and pending motion on hide or skin change", () => {
    const player = new MotionPlayer(library);
    player.press(); player.reset();
    for (let i = 0; i < 20; i++) player.advance();
    expect(player.snapshot.action).toBe("idle");
    expect(player.isHeld).toBe(false);
  });
  it("pressing during recovery completes the return then starts a new held roll", () => {
    const player = new MotionPlayer(library);
    player.press(); player.release();
    for (let i = 0; i < 4; i++) player.advance();
    player.press();
    expect(player.snapshot.frame).toBe(4);
    player.advance(); player.advance();
    expect(player.snapshot).toMatchObject({ action: "belly", frame: 0 });
    expect(player.isHeld).toBe(true);
  });
  it("old skins respond with a calm existing action, never running on grab", () => {
    const player = new MotionPlayer({ idle: library.idle!, waiting: library.waving! });
    player.press();
    expect(player.snapshot.action).toBe("waiting");
  });
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("optional built-in clip decoding", () => {
  const value = { version: 1, size: 208, clips: { idle: {
    file: "idle.webp", file2x: "idle@2x.webp", columns: 4, durations: Array(12).fill(100), loop: true,
  } } };
  function images(failure: "none" | "hires" | "both") {
    const requests: string[] = [];
    vi.stubGlobal("Image", class {
      src = ""; naturalWidth = 0; naturalHeight = 0;
      async decode() {
        requests.push(this.src);
        const scale = this.src.includes("@2x") ? 2 : 1;
        if (failure === "both" || (failure === "hires" && scale === 2)) throw new Error("decode failed");
        this.naturalWidth = 4 * 208 * scale;
        this.naturalHeight = 3 * 208 * scale;
      }
    });
    return requests;
  }
  it("loads original-derived high-density motion", async () => {
    const requests = images("none");
    expect((await loadBuiltinMotions(value, 2)).idle?.scale).toBe(2);
    expect(requests).toEqual(["/builtin/aobai/motion/idle@2x.webp"]);
  });
  it("falls back to standard clip with a diagnostic if HD is unavailable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const requests = images("hires");
    expect((await loadBuiltinMotions(value, 2)).idle?.scale).toBe(1);
    expect(requests).toHaveLength(2);
  });
  it("rejects complete failure so the caller can keep the v2 skin", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    images("both");
    await expect(loadBuiltinMotions(value, 2)).rejects.toThrow("decode failed");
  });
});

describe("bounded variable-frame motion assets", () => {
  const valid = { version: 1, size: 208, clips: { belly: {
    file: "belly.webp", file2x: "belly@2x.webp", columns: 4,
    durations: Array(13).fill(120), heldLoop: [4, 8],
  } } };
  it("accepts more than eight frames and computes geometry from clip length", () => {
    expect(validateMotionManifest(valid).clips.belly?.durations).toHaveLength(13);
  });
  it.each([
    { ...valid, version: 2 },
    { ...valid, size: 192 },
    { ...valid, clips: { belly: { ...valid.clips.belly, file: "../outside.webp" } } },
    { ...valid, clips: { belly: { ...valid.clips.belly, durations: [0] } } },
    { ...valid, clips: { belly: { ...valid.clips.belly, durations: Array(257).fill(100) } } },
    { ...valid, clips: { belly: { ...valid.clips.belly, heldLoop: [8, 4] } } },
  ])("rejects invalid resource metadata", (value) => {
    expect(() => validateMotionManifest(value)).toThrow();
  });
});
