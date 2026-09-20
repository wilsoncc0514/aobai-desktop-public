import { afterEach, describe, expect, it, vi } from "vitest";
import { MotionPlayer, type MotionLibrary } from "../src/animation/motion";
import { loadBuiltinMotions, validateMotionManifest } from "../src/animation/motionAssets";
import manifest from "../public/builtin/aobai/motion/manifest.json";

const library: MotionLibrary = {
  idle: { durations: [100, 200], loop: true },
  belly: { durations: [100, 100, 100, 100, 100, 100], heldLoop: [2, 3] },
  waving: { durations: [100, 500, 100] },
};

describe("single-owner motion controller", () => {
  it.each([["waving", 8970], ["running", 12420]] as const)(
    "bundled %s lasts exactly three times its previous duration", (action, expected) => {
      const player = new MotionPlayer(validateMotionManifest(manifest).clips);
      player.request(action);
      let elapsed = 0;
      for (let i = 0; player.snapshot.action !== "idle" && i < 500; i++) {
        elapsed += player.snapshot.duration; player.advance();
      }
      expect(player.snapshot.action).toBe("idle");
      expect(elapsed).toBeCloseTo(expected, 6);
    });
  it("repeats only the body, then plays recovery once", () => {
    const player = new MotionPlayer({ ...library, waving: {
      durations: [100, 200, 300, 100], repeat: [1, 2, 3],
    } });
    player.request("waving");
    const seen = [];
    while (player.snapshot.action !== "idle" && seen.length < 20) {
      seen.push(player.snapshot.frame); player.advance();
    }
    expect(seen).toEqual([0, 1, 2, 1, 2, 1, 2, 3]);
  });
  it("petting skips remaining body repeats and reset clears repeat progress", () => {
    const player = new MotionPlayer({ ...library, waving: {
      durations: [100, 200, 300, 100], repeat: [1, 2, 3],
    } });
    player.request("waving"); player.advance(); player.press();
    for (let i = 0; i < 3; i++) player.advance();
    expect(player.snapshot.action).toBe("belly");
    player.reset(); player.request("waving");
    for (let i = 0; i < 7; i++) player.advance();
    expect(player.snapshot).toMatchObject({ action: "waving", frame: 3 });
  });
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
  it.each([[0, 2, 3], [2, 1, 3], [1, 3, 3], [1, 2, 0], [1, 2, 33],
    [1, 2, 2.5], [1, 2], [1, 2, Number.NaN]])("rejects invalid body repeat %j", (...repeat) => {
    expect(() => validateMotionManifest({ version: 1, size: 208, clips: { waving: {
      file: "groom.webp", columns: 4, durations: [100, 100, 100, 100], repeat,
    } } })).toThrow();
  });
  it("rejects conflicting loops and excessive repeated duration", () => {
    const clip = { file: "groom.webp", columns: 4, durations: [10000, 10000, 10000, 10000], repeat: [1, 2, 32] };
    for (const extra of [{}, { loop: true }, { heldLoop: [1, 2] }]) {
      expect(() => validateMotionManifest({ version: 1, size: 208, clips: { waving: { ...clip, ...extra } } })).toThrow();
    }
  });
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
