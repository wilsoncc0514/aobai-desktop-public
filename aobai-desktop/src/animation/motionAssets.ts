import type { MotionAction, MotionClip } from "./motion";

export const STAGE_SIZE = 208;
const MOTION_ACTIONS = [
  "idle", "belly", "waving", "running", "review", "sleep", "sleep-enter", "sleep-exit",
] as const;
const MAX_CLIP_FRAMES = 128;
const MAX_TOTAL_FRAMES = 256;

interface MotionAsset extends MotionClip {
  readonly file: string;
  readonly file2x?: string;
  readonly columns: number;
}
export interface MotionManifest {
  readonly version: 1;
  readonly size: typeof STAGE_SIZE;
  readonly clips: Partial<Record<MotionAction, MotionAsset>>;
}
export interface LoadedMotion extends MotionAsset {
  readonly image: HTMLImageElement;
  readonly scale: number;
}
export type LoadedMotions = Partial<Record<MotionAction, LoadedMotion>>;

const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const filename = (v: unknown): v is string =>
  typeof v === "string" && /^[a-z][a-z0-9-]*(@2x)?\.webp$/.test(v);

export function validateMotionManifest(value: unknown): MotionManifest {
  if (!record(value) || value.version !== 1 || value.size !== STAGE_SIZE || !record(value.clips)) {
    throw new Error("不支持的桌宠动作格式");
  }
  let total = 0;
  for (const [name, clip] of Object.entries(value.clips)) {
    if (!(MOTION_ACTIONS as readonly string[]).includes(name) || !record(clip) ||
        !filename(clip.file) || (clip.file2x !== undefined && !filename(clip.file2x)) ||
        !Number.isInteger(clip.columns) || Number(clip.columns) < 1 || Number(clip.columns) > 8 ||
        !Array.isArray(clip.durations) || clip.durations.length < 1 || clip.durations.length > MAX_CLIP_FRAMES ||
        !clip.durations.every((n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 40 && n <= 10_000) ||
        (clip.loop !== undefined && typeof clip.loop !== "boolean")) {
      throw new Error(`无效动作资源：${name}`);
    }
    if (Math.ceil(clip.durations.length / Number(clip.columns)) * STAGE_SIZE * 2 > 8192) {
      throw new Error(`动作图集过高：${name}`);
    }
    if (clip.heldLoop !== undefined && (!Array.isArray(clip.heldLoop) || clip.heldLoop.length !== 2 ||
        !clip.heldLoop.every(Number.isInteger) || clip.heldLoop[0] < 0 ||
        clip.heldLoop[1] < clip.heldLoop[0] || clip.heldLoop[1] >= clip.durations.length - 1)) {
      throw new Error(`无效动作循环：${name}`);
    }
    total += clip.durations.length;
    if (clip.repeat !== undefined) {
      const repeat = clip.repeat;
      if (!Array.isArray(repeat) || repeat.length !== 3 || !repeat.every(Number.isInteger) ||
          repeat[0] < 1 || repeat[1] < repeat[0] || repeat[1] >= clip.durations.length - 1 ||
          repeat[2] < 2 || repeat[2] > 32 || clip.loop || clip.heldLoop !== undefined) {
        throw new Error(`无效主体重复：${name}`);
      }
      const duration = clip.durations.reduce((sum: number, n: number) => sum + n, 0) +
        clip.durations.slice(repeat[0], repeat[1] + 1)
          .reduce((sum: number, n: number) => sum + n, 0) * (repeat[2] - 1);
      if (duration > 120_000) throw new Error(`动作重复超过时长预算：${name}`);
    }
  }
  if (total > MAX_TOTAL_FRAMES) throw new Error("动作资源超过总帧预算");
  return value as unknown as MotionManifest;
}

async function loadMotionImage(clip: MotionAsset, scale: number): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = `/builtin/aobai/motion/${scale === 2 ? clip.file2x : clip.file}`;
  await image.decode();
  if (image.naturalWidth !== clip.columns * STAGE_SIZE * scale ||
      image.naturalHeight !== Math.ceil(clip.durations.length / clip.columns) * STAGE_SIZE * scale) {
    throw new Error(`动作图集尺寸无效：${clip.file}`);
  }
  return image;
}

/** Only bundled metadata is accepted. No external pet.json/path contract changes. */
export async function loadBuiltinMotions(value: unknown, displayScale: number): Promise<LoadedMotions> {
  const manifest = validateMotionManifest(value);
  const output: LoadedMotions = {};
  // Sequential decode bounds transient image allocations during skin switching.
  for (const [name, clip] of Object.entries(manifest.clips)) {
    let scale = displayScale > 1 && clip.file2x ? 2 : 1;
    let image: HTMLImageElement;
    try { image = await loadMotionImage(clip, scale); }
    catch (error) {
      if (scale === 1) throw error;
      console.warn("高清动作不可用，退回标准动作", error);
      scale = 1;
      image = await loadMotionImage(clip, scale);
    }
    output[name as MotionAction] = { ...clip, image, scale };
  }
  return output;
}

export function drawMotionFrame(context: CanvasRenderingContext2D, clip: LoadedMotion, frame: number): void {
  const cell = STAGE_SIZE * clip.scale;
  context.globalCompositeOperation = "copy";
  context.drawImage(clip.image, (frame % clip.columns) * cell,
    Math.floor(frame / clip.columns) * cell, cell, cell, 0, 0, STAGE_SIZE, STAGE_SIZE);
  context.globalCompositeOperation = "source-over";
}
