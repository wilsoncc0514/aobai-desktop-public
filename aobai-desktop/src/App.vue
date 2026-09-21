<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watchEffect } from "vue";
import { ANIMATIONS, isPetState, type PetState } from "./animation/catalog";
import {
  configureCanvasForDisplay,
  ATLAS_WIDTH,
  ALLBUY_LEGACY_BODY_SCALE,
  drawAtlasFrame,
} from "./animation/atlas";
import { legacyMotionLibrary, MotionPlayer, type MotionAction } from "./animation/motion";
import { drawMotionFrame, loadBuiltinMotions, type LoadedMotions } from "./animation/motionAssets";
import motionManifest from "../public/builtin/aobai/motion/manifest.json";
import {
  availableBehaviorActionsForMotions,
  behaviorActionToMotionAction,
  motionActionToBehaviorAction,
  type BehaviorAction,
} from "./behavior/actions";
import { appendRecentAction, type PetContext } from "./behavior/context";
import { RuleDecisionProvider } from "./behavior/ruleDecisionProvider";
import { SleepSession } from "./behavior/sleepSession";
import {
  nextAmbientDelayMs,
  selectAmbientAction,
} from "./behavior/stateMachine";
import {
  centerWindow,
  applyWindowLayer,
  getAutostartEnabled,
  hideWindow,
  listenForTrayLayer,
  listenForTrayMode,
  listenForTraySkinReload,
  listenForTraySkin,
  loadSettings,
  getWindowPosition,
  moveWindowTo,
  onWindowMoved,
  restoreWindowPosition,
  saveSettings,
  setAutostartEnabled,
  showPetContextMenu,
  startWindowDrag,
  type ContextMenuAction,
} from "./platform/desktop";
import {
  draggedWindowPosition,
  shouldUseManualWindowDrag,
  type Point,
} from "./platform/drag";
import {
  DEFAULT_SETTINGS,
  type ActivityMode,
  type DesktopSettings,
  type WindowLayer,
} from "./settings/schema";
import { BUILTIN_SKIN, preloadSkin, scanSkins, type SkinInfo } from "./skins/catalog";

const settings = ref<DesktopSettings>(DEFAULT_SETTINGS);
const currentState = ref<MotionAction>("idle");
const frameIndex = ref(0);
const statusText = ref("");
const isDragging = ref(false);
const canvas = ref<HTMLCanvasElement | null>(null);
const skins = ref<readonly SkinInfo[]>([BUILTIN_SKIN]);
const atlasImage = shallowRef<HTMLImageElement | null>(null);
const motions = shallowRef<LoadedMotions>({});
let player = new MotionPlayer(legacyMotionLibrary());
let skinLoadEpoch = 0;
let builtinMotionLoad: Promise<LoadedMotions> | undefined;
let disposed = false;

let animationTimer: number | undefined;
let ambientTimer: number | undefined;
let statusTimer: number | undefined;
let saveTimer: number | undefined;
let pointerStart: {
  point: Point;
  origin: Promise<Point | null>;
  pointerId: number;
  manual: boolean;
} | null = null;
let pendingDragPosition: Point | null = null;
let dragMoveInFlight = false;
let lastFrameAt = 0;
let previousAmbientState: PetState | null = null;
let previousBehaviorAction: BehaviorAction | null = null;
let recentBehaviorActions: readonly BehaviorAction[] = [];
let lastAmbientActionAt = Date.now();
let lastUserInteractionAt = Date.now();
const decisionProvider = new RuleDecisionProvider();
const sleepSession = new SleepSession();
const cleanups: Array<() => void> = [];

const modeLabel = computed(() => ({ quiet: "安静", normal: "普通", active: "活跃" })[settings.value.mode]);

function showStatus(message: string): void {
  statusText.value = message;
  if (statusTimer !== undefined) window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => (statusText.value = ""), 2_400);
}

function syncMotion(): void {
  currentState.value = player.snapshot.action;
  frameIndex.value = player.snapshot.frame;
}

function play(state: MotionAction): void {
  player.request(state);
  syncMotion();
  lastFrameAt = performance.now();
}

function cancelSleepSession(): void {
  if (!sleepSession.cancel()) return;
  player.reset();
  syncMotion();
  lastFrameAt = performance.now();
}

function scheduleAmbientAction(): void {
  if (ambientTimer !== undefined) window.clearTimeout(ambientTimer);
  const delay = nextAmbientDelayMs(settings.value.mode, Math.random());
  if (delay === null) return;
  ambientTimer = window.setTimeout(() => {
    if (
      document.visibilityState === "visible" &&
      currentState.value === "idle" &&
      !player.isHeld
    ) {
      const availableMotions = motions.value.idle ? Object.keys(motions.value) : null;
      if (availableMotions === null) {
        const state = selectAmbientAction(
          settings.value.mode,
          Math.random(),
          previousAmbientState,
        );
        previousAmbientState = state;
        play(state);
      } else {
        const now = Date.now();
        const availableActions = availableBehaviorActionsForMotions(availableMotions);
        const context: PetContext = {
          mode: settings.value.mode,
          currentAction: motionActionToBehaviorAction(currentState.value) ?? "idle",
          previousAction: previousBehaviorAction,
          recentActions: recentBehaviorActions,
          secondsSinceLastAmbientAction: Math.max(0, (now - lastAmbientActionAt) / 1_000),
          secondsSinceUserInteraction: Math.max(0, (now - lastUserInteractionAt) / 1_000),
          hour: new Date(now).getHours(),
        };
        const behaviorAction = decisionProvider.decide(
          context,
          availableActions,
          Math.random(),
        );
        previousBehaviorAction = behaviorAction;
        recentBehaviorActions = appendRecentAction(recentBehaviorActions, behaviorAction);
        lastAmbientActionAt = now;
        if (behaviorAction === "sleep") {
          const withTransitions = Boolean(motions.value["sleep-enter"] && motions.value["sleep-exit"]);
          sleepSession.start(Math.random(), withTransitions);
          play(withTransitions ? "sleep-enter" : "sleep");
        } else {
          sleepSession.cancel();
          play(behaviorActionToMotionAction(behaviorAction));
        }
      }
    }
    scheduleAmbientAction();
  }, delay);
}

function startAnimationClock(): void {
  lastFrameAt = performance.now();
  animationTimer = window.setInterval(() => {
    if (document.visibilityState !== "visible") return;
    const now = performance.now();
    const frameDuration = player.snapshot.duration;
    if (now - lastFrameAt < frameDuration) return;
    lastFrameAt = now;
    const before = player.snapshot;
    player.advance();
    const command = sleepSession.observeAdvance(before, player.snapshot);
    if (command === "sleep" || command === "sleep-exit") player.replace(command);
    else if (command === "complete") player.reset();
    syncMotion();
  }, 32);
}

async function activateSkin(id: string, persist = true): Promise<void> {
  cancelSleepSession();
  const skin = skins.value.find((candidate) => candidate.id === id) ?? BUILTIN_SKIN;
  const epoch = ++skinLoadEpoch;
  try {
    const image = await preloadSkin(skin);
    let loaded: LoadedMotions = {};
    if (skin.id === BUILTIN_SKIN.id) {
      try {
        builtinMotionLoad ??= loadBuiltinMotions(motionManifest, window.devicePixelRatio);
        loaded = await builtinMotionLoad;
      } catch (error) {
        builtinMotionLoad = undefined;
        console.error("扩展动作加载失败，使用标准 v2 动作", error);
      }
    }
    if (disposed || epoch !== skinLoadEpoch) return;
    cancelInteraction();
    player = new MotionPlayer({ ...legacyMotionLibrary(), ...loaded });
    motions.value = loaded;
    previousBehaviorAction = null;
    recentBehaviorActions = [];
    lastAmbientActionAt = Date.now();
    atlasImage.value = image;
    if (persist) {
      settings.value = { ...settings.value, selectedSkinId: skin.id };
      persistSoon();
    }
    syncMotion();
    showStatus(skin.id === BUILTIN_SKIN.id && !loaded.belly ? "扩展动作未就绪，使用标准皮肤" : `已切换为${skin.displayName}`);
  } catch (error) {
    if (disposed || epoch !== skinLoadEpoch) return;
    console.error("皮肤加载失败", error);
    if (skin.id !== BUILTIN_SKIN.id) await activateSkin(BUILTIN_SKIN.id, false);
    showStatus("皮肤无效，已使用鳌拜");
  }
}

async function reloadSkins(showResult = true): Promise<void> {
  try {
    const result = await scanSkins();
    skins.value = result.skins;
    await activateSkin(settings.value.selectedSkinId, false);
    if (showResult) showStatus(result.warnings.length ? `已载入 ${result.skins.length} 个，部分无效` : `已载入 ${result.skins.length} 个皮肤`);
  } catch (error) {
    console.error("扫描皮肤失败", error);
    skins.value = [BUILTIN_SKIN];
    await activateSkin(BUILTIN_SKIN.id, false);
    showStatus("skin 目录读取失败");
  }
}

function persistSoon(nextSettings = settings.value): void {
  if (saveTimer !== undefined) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void saveSettings(nextSettings).catch((error: unknown) => {
      console.error("保存设置失败", error);
      showStatus("设置保存失败");
    });
  }, 250);
}

function setMode(mode: ActivityMode): void {
  settings.value = { ...settings.value, mode };
  previousAmbientState = null;
  previousBehaviorAction = null;
  recentBehaviorActions = [];
  lastAmbientActionAt = Date.now();
  cancelInteraction();
  player.settle();
  syncMotion();
  scheduleAmbientAction();
  persistSoon();
  showStatus(`${modeLabel.value}模式`);
}

async function setWindowLayer(layer: WindowLayer): Promise<void> {
  try {
    await applyWindowLayer(layer);
    settings.value = { ...settings.value, windowLayer: layer };
    persistSoon();
    const label = { top: "置顶", normal: "普通层级", bottom: "置底" }[layer];
    showStatus(`已设为${label}`);
  } catch (error) {
    console.error("切换窗口层级失败", error);
    showStatus("窗口层级设置失败");
  }
}

async function toggleAutostart(): Promise<void> {
  const desired = !settings.value.autostart;
  try {
    await setAutostartEnabled(desired);
    settings.value = { ...settings.value, autostart: desired };
    persistSoon();
    showStatus(desired ? "已开启开机启动" : "已关闭开机启动");
  } catch (error) {
    console.error("切换开机启动失败", error);
    showStatus("开机启动设置失败");
  }
}

async function resetPosition(): Promise<void> {
  cancelSleepSession();
  try {
    await centerWindow();
    showStatus("位置已重置");
  } catch (error) {
    console.error("重置窗口位置失败", error);
    showStatus("位置重置失败");
  }
}

async function temporarilyHide(): Promise<void> {
  try {
    cancelInteraction();
    player.reset();
    syncMotion();
    await hideWindow();
  } catch (error) {
    console.error("隐藏窗口失败", error);
    showStatus("隐藏失败");
  }
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || pointerStart !== null) return;
  lastUserInteractionAt = Date.now();
  cancelSleepSession();
  const manual = shouldUseManualWindowDrag(navigator.userAgent);
  if (manual && event.currentTarget instanceof Element) {
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  pointerStart = {
    point: { x: event.screenX, y: event.screenY },
    origin: manual ? getWindowPosition().catch((error: unknown) => {
      console.error("读取拖动起点失败", error);
      showStatus("无法读取窗口位置");
      return null;
    }) : Promise.resolve({ x: 0, y: 0 }),
    pointerId: event.pointerId,
    manual,
  };
  isDragging.value = false;
  player.press();
  syncMotion();
  lastFrameAt = performance.now();
}

async function flushPendingDragMove(): Promise<void> {
  if (dragMoveInFlight) return;
  dragMoveInFlight = true;
  try {
    while (pendingDragPosition !== null) {
      const next = pendingDragPosition;
      pendingDragPosition = null;
      await moveWindowTo(next);
    }
  } catch (error) {
    console.error("拖动窗口失败", error);
    showStatus("拖动失败");
  } finally {
    dragMoveInFlight = false;
  }
}

async function onPointerMove(event: PointerEvent): Promise<void> {
  const start = pointerStart;
  if (start === null || event.pointerId !== start.pointerId) return;
  const current = { x: event.screenX, y: event.screenY };
  const distance = Math.hypot(current.x - start.point.x, current.y - start.point.y);
  if (!isDragging.value && distance < 6) return;
  isDragging.value = true;
  try {
    if (!start.manual) {
      pointerStart = null;
      await startWindowDrag();
      player.release();
      isDragging.value = false;
      return;
    }
    const origin = await start.origin;
    if (pointerStart !== start || origin === null || disposed) return;
    pendingDragPosition = draggedWindowPosition(
      origin,
      start.point,
      current,
      window.devicePixelRatio,
    );
    void flushPendingDragMove();
  } catch (error) {
    console.error("拖动窗口失败", error);
    showStatus("拖动失败");
  }
}

function onPointerEnd(event: PointerEvent): void {
  if (pointerStart === null || event.pointerId !== pointerStart.pointerId) return;
  pointerStart = null;
  if (
    event.currentTarget instanceof Element &&
    event.currentTarget.hasPointerCapture(event.pointerId)
  ) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
  pendingDragPosition = null;
  player.release();
  isDragging.value = false;
}

function cancelInteraction(): void {
  cancelSleepSession();
  const pointerId = pointerStart?.pointerId;
  pointerStart = null;
  pendingDragPosition = null;
  const target = canvas.value?.parentElement;
  if (pointerId !== undefined && target?.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
  player.release();
  isDragging.value = false;
}

function onKeyboardPet(event: KeyboardEvent): void {
  if (event.repeat) return;
  lastUserInteractionAt = Date.now();
  cancelSleepSession();
  player.press(); player.release(); syncMotion();
  lastFrameAt = performance.now();
}

async function handleMenuAction(action: ContextMenuAction): Promise<void> {
  if (action.startsWith("mode:")) {
    setMode(action.slice(5) as ActivityMode);
    return;
  }
  if (action.startsWith("layer:")) {
    await setWindowLayer(action.slice(6) as WindowLayer);
    return;
  }
  if (action.startsWith("skin:")) await activateSkin(action.slice(5));
  if (action.startsWith("motion:")) {
    const motionName = action.slice(7);
    lastUserInteractionAt = Date.now();
    if (motionName === "sleep") {
      if (sleepSession.snapshot.active) {
        cancelSleepSession();
      } else {
        const withTransitions = Boolean(motions.value["sleep-enter"] && motions.value["sleep-exit"]);
        sleepSession.start(Math.random(), withTransitions);
        play(withTransitions ? "sleep-enter" : "sleep");
      }
    } else {
      cancelSleepSession();
      play(motionName as MotionAction);
    }
    return;
  }
  if (action === "reload-skins") await reloadSkins();
  if (action === "toggle-autostart") await toggleAutostart();
  if (action === "reset-position") await resetPosition();
  if (action === "hide") await temporarilyHide();
}

async function openMenu(): Promise<void> {
  cancelInteraction();
  try {
    await showPetContextMenu(settings.value, skins.value, (action) => void handleMenuAction(action));
  } catch (error) {
    console.error("打开右键菜单失败", error);
    showStatus("菜单打开失败");
  }
}

onMounted(async () => {
  const onVisibility = () => {
    if (document.visibilityState !== "visible") {
      cancelInteraction(); player.reset(); syncMotion();
    }
    lastFrameAt = performance.now();
  };
  window.addEventListener("blur", cancelInteraction);
  document.addEventListener("visibilitychange", onVisibility);
  cleanups.push(() => window.removeEventListener("blur", cancelInteraction));
  cleanups.push(() => document.removeEventListener("visibilitychange", onVisibility));
  startAnimationClock();
  try {
    settings.value = await loadSettings();
    await applyWindowLayer(settings.value.windowLayer);
    await restoreWindowPosition(settings.value);
    const actualAutostart = await getAutostartEnabled();
    if (actualAutostart !== settings.value.autostart) {
      settings.value = { ...settings.value, autostart: actualAutostart };
      persistSoon();
    }
  } catch (error) {
    console.error("加载设置失败，使用默认值", error);
    settings.value = DEFAULT_SETTINGS;
    showStatus("设置损坏，已使用默认值");
  }
  await nextTick();
  await reloadSkins(false);

  cleanups.push(
    await onWindowMoved((position) => {
      settings.value = { ...settings.value, position };
      persistSoon();
    }),
  );
  cleanups.push(await listenForTrayMode(setMode));
  cleanups.push(await listenForTrayLayer((layer) => void setWindowLayer(layer)));
  cleanups.push(await listenForTraySkinReload(() => void reloadSkins()));
  cleanups.push(await listenForTraySkin((id) => void activateSkin(id)));
  scheduleAmbientAction();
});

watchEffect((onCleanup) => {
  const target = canvas.value;
  const image = atlasImage.value;
  const action = currentState.value;
  const motion = motions.value[action];
  const frame = frameIndex.value;
  if (!target || !image) return;
  const renderRequest = window.requestAnimationFrame(() => {
    const context = configureCanvasForDisplay(target, window.devicePixelRatio);
    if (!context) return;
    if (motion) drawMotionFrame(context, motion, frame);
    else if (isPetState(action)) drawAtlasFrame(context, image, ANIMATIONS[action].row, frame,
      image.naturalWidth / ATLAS_WIDTH, motions.value.idle ? ALLBUY_LEGACY_BODY_SCALE : 1);
  });
  onCleanup(() => window.cancelAnimationFrame(renderRequest));
});

onBeforeUnmount(() => {
  disposed = true;
  skinLoadEpoch++;
  cancelInteraction();
  if (animationTimer !== undefined) window.clearInterval(animationTimer);
  if (ambientTimer !== undefined) window.clearTimeout(ambientTimer);
  if (statusTimer !== undefined) window.clearTimeout(statusTimer);
  if (saveTimer !== undefined) window.clearTimeout(saveTimer);
  cleanups.forEach((cleanup) => cleanup());
});
</script>

<template>
  <main
    class="pet-stage"
    @contextmenu.prevent="openMenu"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerEnd"
    @pointercancel="onPointerEnd"
    @lostpointercapture="onPointerEnd"
  >
    <div v-if="statusText" class="speech-bubble" role="status">{{ statusText }}</div>

    <canvas
      ref="canvas"
      class="pet-image"
      :aria-label="`桌宠正在执行 ${currentState} 动作`"
      role="button"
      tabindex="0"
      title="按住撒娇并拖动，右键打开菜单"
      @keydown.enter.prevent="onKeyboardPet"
      @keydown.space.prevent="onKeyboardPet"
    ></canvas>

    <div class="mode-indicator" aria-hidden="true">{{ modeLabel }}</div>
  </main>
</template>
