import { describe, expect, it } from "vitest";
import { PetWindowLayout } from "../src/platform/petWindowLayout";

function fixture(scale = 1) {
  let position = { x: 80, y: 100 }, height = 272 * scale;
  const layout = new PetWindowLayout({
    position: async () => ({ ...position }), height: async () => height,
    scale: async () => scale,
    resize: async logical => { height = Math.round(logical * scale); },
    move: async p => { position = p; },
  });
  return { layout, state: () => ({ position, height }) };
}
describe("pet bubble window", () => {
  it.each([1, 1.5, 2])("keeps the body fixed and old saved coordinates at scale %s", async scale => {
    const { layout, state } = fixture(scale);
    await layout.request(false);
    expect(state()).toEqual({ position: { x: 80, y: 100 + 64 * scale }, height: 208 * scale });
    expect(await layout.storedPosition()).toEqual({ x: 80, y: 100 });
    await layout.request(true);
    expect(state()).toEqual({ position: { x: 80, y: 100 }, height: 272 * scale });
  });
  it("defers resizing while the pet is being held and uses the latest request", async () => {
    const { layout, state } = fixture();
    await layout.suspend(true);
    await layout.request(false);
    expect(state().height).toBe(272);
    await layout.request(true);
    await layout.request(false);
    await layout.suspend(false);
    expect(state().height).toBe(208);
  });
  it("restores the previous size when repositioning fails", async () => {
    let height = 272;
    const layout = new PetWindowLayout({
      position: async () => ({ x: 80, y: 100 }), height: async () => height,
      scale: async () => 1, resize: async h => { height = h; },
      move: async () => { throw new Error("move failed"); },
    });
    await expect(layout.request(false)).rejects.toThrow("move failed");
    expect(height).toBe(272);
  });
  it("serializes rapid changes and ends in the latest state", async () => {
    const { layout, state } = fixture();
    await Promise.all([layout.request(false), layout.request(true), layout.request(false)]);
    expect(state().height).toBe(208);
    expect(await layout.storedPosition()).toEqual({ x: 80, y: 100 });
  });
});
