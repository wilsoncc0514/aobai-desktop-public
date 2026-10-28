import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve("scripts/check-public-assets.mjs");
const fixtures = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "aobai-public-assets-"));
  fixtures.push(root);
  mkdirSync(join(root, "public/builtin/aobai"), { recursive: true });
  return root;
}
function copy(root) {
  return spawnSync(process.execPath, [script, "--copy"], { cwd: root, encoding: "utf8" });
}
afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("production public assets", () => {
  it("copies runtime assets while leaving legacy cache out of dist and intact", () => {
    const root = fixture();
    writeFileSync(join(root, "public/builtin/aobai/pet.json"), "{}");
    mkdirSync(join(root, "public/pet"));
    const cache = join(root, "public/pet/old-frame.png");
    writeFileSync(cache, "local frame cache");
    expect(copy(root).status).toBe(0);
    expect(readFileSync(join(root, "dist/builtin/aobai/pet.json"), "utf8")).toBe("{}");
    expect(existsSync(join(root, "dist/pet"))).toBe(false);
    expect(readFileSync(cache, "utf8")).toBe("local frame cache");
  });

  it("rejects hidden runtime source files before copying", () => {
    const root = fixture();
    writeFileSync(join(root, "public/builtin/aobai/.backup"), "source backup");
    expect(copy(root).status).toBe(1);
    expect(existsSync(join(root, "dist/builtin"))).toBe(false);
  });

  it("rejects linked directories before copying outside files", () => {
    const root = fixture();
    const outside = join(root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "local.txt"), "outside runtime scope");
    symlinkSync(outside, join(root, "public/builtin/linked"), "junction");
    expect(copy(root).status).toBe(1);
    expect(existsSync(join(root, "dist/builtin"))).toBe(false);
  });

  it("rejects a linked builtin root before copying", () => {
    const root = fixture();
    const outside = join(root, "outside");
    mkdirSync(outside);
    rmSync(join(root, "public/builtin"), { recursive: true });
    symlinkSync(outside, join(root, "public/builtin"), "junction");
    expect(copy(root).status).toBe(1);
    expect(existsSync(join(root, "dist/builtin"))).toBe(false);
  });
});
