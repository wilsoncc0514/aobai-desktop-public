export const ATLAS_COLUMNS = 8;
export const ATLAS_ROWS = 11;
export const FRAME_WIDTH = 192;
export const FRAME_HEIGHT = 208;
export const ATLAS_WIDTH = ATLAS_COLUMNS * FRAME_WIDTH;
export const ATLAS_HEIGHT = ATLAS_ROWS * FRAME_HEIGHT;
export const MAX_RENDER_SCALE = 3;
export const CANVAS_SIZE = 208;
// AllBuy's approved v2 neutral bounds are y=5..203. New motion art uses
// 170px neutral height and a 192px contact plane; external skins stay unscaled.
export const ALLBUY_LEGACY_BODY_SCALE = 170 / 198;
const ALLBUY_LEGACY_CONTACT_Y = 203;
const MOTION_CONTACT_Y = 192;

export function configureCanvasForDisplay(
  canvas: HTMLCanvasElement,
  requestedScale: number,
): CanvasRenderingContext2D | null {
  const scale = Number.isFinite(requestedScale)
    ? Math.min(Math.max(requestedScale, 1), MAX_RENDER_SCALE)
    : 1;
  const width = Math.round(CANVAS_SIZE * scale);
  const height = Math.round(CANVAS_SIZE * scale);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) return null;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  return context;
}

export function drawAtlasFrame(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  row: number,
  frame: number,
  sourceScale = 1,
  bodyScale = 1,
): void {
  // Replace the complete transparent cell in one operation: do not expose a
  // cleared canvas between clearRect and a large high-density image upload.
  context.globalCompositeOperation = "copy";
  context.drawImage(
    image,
    frame * FRAME_WIDTH * sourceScale,
    row * FRAME_HEIGHT * sourceScale,
    FRAME_WIDTH * sourceScale,
    FRAME_HEIGHT * sourceScale,
    (CANVAS_SIZE - FRAME_WIDTH * bodyScale) / 2,
    bodyScale === 1 ? 0 : MOTION_CONTACT_Y - ALLBUY_LEGACY_CONTACT_Y * bodyScale,
    FRAME_WIDTH * bodyScale,
    FRAME_HEIGHT * bodyScale,
  );
  context.globalCompositeOperation = "source-over";
}
