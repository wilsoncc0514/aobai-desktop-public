import { describe, expect, it, vi } from "vitest";
import {
  configureCanvasForDisplay,
  drawAtlasFrame,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  ALLBUY_LEGACY_BODY_SCALE,
} from "../src/animation/atlas";

describe("atlas renderer", () => {
  it("selects the exact source cell", () => {
    const context = { clearRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
    const image = {} as CanvasImageSource;
    drawAtlasFrame(context, image, 3, 4);
    expect(context.drawImage).toHaveBeenCalledWith(
      image, 4 * FRAME_WIDTH, 3 * FRAME_HEIGHT, FRAME_WIDTH, FRAME_HEIGHT,
      8, 0, FRAME_WIDTH, FRAME_HEIGHT,
    );
  });

  it("uses a high-DPI backing store while keeping logical frame coordinates", () => {
    const context = {
      setTransform: vi.fn(),
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
      getContext: vi.fn(() => context),
    } as unknown as HTMLCanvasElement;

    expect(configureCanvasForDisplay(canvas, 2)).toBe(context);
    expect(canvas.width).toBe(FRAME_HEIGHT * 2);
    expect(canvas.height).toBe(FRAME_HEIGHT * 2);
    expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(context.imageSmoothingQuality).toBe("high");
  });

  it("reads a 2x source cell without changing logical display size", () => {
    const context = { clearRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
    const image = {} as CanvasImageSource;
    drawAtlasFrame(context, image, 5, 6, 2);
    expect(context.drawImage).toHaveBeenCalledWith(
      image, 6 * 384, 5 * 416, 384, 416, 8, 0, 192, 208,
    );
  });

  it("bounds backing-store memory and handles a missing canvas context", () => {
    const canvas = { width: 0, height: 0, getContext: () => null } as unknown as HTMLCanvasElement;
    expect(configureCanvasForDisplay(canvas, 10)).toBeNull();
    expect(canvas.width).toBe(624);
    configureCanvasForDisplay(canvas, Number.NaN);
    expect(canvas.width).toBe(208);
  });

  it("replaces a frame without a separately cleared intermediate canvas", () => {
    const context = {
      globalCompositeOperation: "source-over",
      clearRect: vi.fn(),
      drawImage: vi.fn(() => expect(context.globalCompositeOperation).toBe("copy")),
    } as unknown as CanvasRenderingContext2D;
    drawAtlasFrame(context, {} as CanvasImageSource, 0, 0);
    expect(context.clearRect).not.toHaveBeenCalled();
    expect(context.globalCompositeOperation).toBe("source-over");
  });
  it("aligns remaining AllBuy v2 poses to the motion body's neutral scale", () => {
    const context = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
    drawAtlasFrame(context, {} as CanvasImageSource, 6, 0, 1, ALLBUY_LEGACY_BODY_SCALE);
    const args = vi.mocked(context.drawImage).mock.calls[0]!;
    expect(args[7]).toBeCloseTo(192 * 170 / 198);
    expect(Number(args[6]) + 203 * ALLBUY_LEGACY_BODY_SCALE).toBeCloseTo(192);
  });
});
