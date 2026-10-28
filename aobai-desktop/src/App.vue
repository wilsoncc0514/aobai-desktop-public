<script setup lang="ts">
import { getCodexStatus, setCodexEnabled, openCodexTask, acknowledgeCodex, listenCodex } from "./codex/desktop";
import { EMPTY_CODEX, isBusy, newerSnapshot, primaryNotice, noticeText, noticeSpeech, type CodexNotice, type CodexSnapshot } from "./codex/model";
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watchEffect } from "vue";
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
import { AmbientDecisionGate } from "./behavior/ambientDecisionGate";
import { AmbientRest } from "./behavior/ambientRest";
import { DecisionTrace } from "./behavior/decisionTrace";
import { createBehaviorDecisionProvider } from "./behavior/provider";
import { SleepSession } from "./behavior/sleepSession";
import {
  selectAmbientAction,
} from "./behavior/stateMachine";
import {
  centerWindow,
  applyWindowLayer,
  deleteJevKey,
  getAutostartEnabled,
  focusPetWindow,
  getJevStatus,
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
  setJevEnabled,
  showPetContextMenu,
  syncTrayContextMenu,
  startWindowDrag,
  testJevConnection,
  verifyAndSaveJevKey,
  type ContextMenuAction,
  type JevStatus,
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
let skinLoading = false;
let builtinMotionLoad: Promise<LoadedMotions> | undefined;
let disposed = false;

let animationTimer: number | undefined;
let statusTimer: number | undefined;
let saveTimer: number | undefined;
let settingsSaveChain: Promise<void> = Promise.resolve();
let jevOperationEpoch = 0;
let jevConnectionEpoch = 0;
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
const jevStatus = ref<JevStatus>({
  loading: true,
  configured: false,
  enabled: false,
});
const ambientGate = new AmbientDecisionGate();
const ambientRest = new AmbientRest();
const decisionTrace = import.meta.env.DEV ? new DecisionTrace() : null;
let decisionProvider = createBehaviorDecisionProvider();
const sleepSession = new SleepSession();
const cleanups: Array<() => void> = [];
const codex = shallowRef<CodexSnapshot>(EMPTY_CODEX);
const codexReminder = shallowRef<CodexNotice>();
const reminderFading = ref(false);
const seenReminderKeys = new Set<string>();
let reminderTimer: number | undefined;
let reminderRemovalTimer: number | undefined;
function clearReminder(): void {
  window.clearTimeout(reminderTimer);
  window.clearTimeout(reminderRemovalTimer);
  codexReminder.value = undefined;
  reminderFading.value = false;
}
function showReminder(notice: CodexNotice): void {
  clearReminder();
  codexReminder.value = notice;
  reminderTimer = window.setTimeout(() => {
    reminderFading.value = true;
    reminderRemovalTimer = window.setTimeout(clearReminder, 300);
  }, 4_000);
}
let codexOperationPending = false;
function acceptCodex(snapshot: CodexSnapshot): void {
  if (disposed || newerSnapshot(codex.value, snapshot) !== snapshot) return;
  codex.value = snapshot;
  if (!snapshot.enabled) { clearReminder(); return; }
  if (codexReminder.value && !snapshot.notices.some(n => n.key === codexReminder.value?.key)) clearReminder();
  const fresh = snapshot.notices.filter(n => !seenReminderKeys.has(n.key));
  for (const n of fresh) seenReminderKeys.add(n.key);
  while (seenReminderKeys.size > 256) seenReminderKeys.delete(seenReminderKeys.values().next().value!);
  const next = primaryNotice({ ...snapshot, notices: fresh });
  if (next) showReminder(next);
}
async function startCodexView(): Promise<void> {
  try {
    const unlisten = await listenCodex(acceptCodex);
    if (disposed) { unlisten(); return; }
    cleanups.push(unlisten);
    acceptCodex(await getCodexStatus());
    if (disposed) return;
  } catch { if (!disposed) showStatus("Codex 状态暂不可用"); }
}


async function refreshJevStatus(expectedEpoch?: number, retryUnavailable = false): Promise<JevStatus | null> {
  try {
    const status = await getJevStatus(retryUnavailable);
    if (disposed) return null;
    if (expectedEpoch !== undefined && expectedEpoch !== jevOperationEpoch) return null;
    jevStatus.value = {
      configured: status.configured,
      enabled: status.enabled,
      connected: status.configured ? jevStatus.value.connected : undefined,
    };
    decisionProvider = createBehaviorDecisionProvider(status.enabled ? "jev" : "rule", undefined, decisionTrace ?? undefined);
    ambientGate.invalidate();
    return status;
  } catch {
    if (expectedEpoch !== undefined && expectedEpoch !== jevOperationEpoch) return null;
    jevStatus.value = { configured: false, enabled: false, credentialError: true };
    decisionProvider = createBehaviorDecisionProvider("rule");
    ambientGate.invalidate();
    console.warn("读取 Jev 状态失败，已使用本地规则");
    return null;
  }
}

function showStatus(message: string): void {
  statusText.value = message;
  if (statusTimer !== undefined) window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => (statusText.value = ""), 2_400);
}

function syncMotion(): void {
  currentState.value = player.snapshot.action;
  frameIndex.value = player.snapshot.frame;
  scheduleAmbientAction();
}

function play(state: MotionAction): void {
  player.request(state);
  syncMotion();
  lastFrameAt = performance.now();
}

function cancelSleepSession(): void {
  ambientGate.invalidate();
  if (!sleepSession.cancel()) return;
  player.settle();
  syncMotion();
  lastFrameAt = performance.now();
}

function scheduleAmbientAction(): void {
  const resting = !disposed && !skinLoading && atlasImage.value !== null &&
    document.visibilityState === "visible" && pointerStart === null && player.isResting;
  if (!ambientRest.poll(settings.value.mode, resting, performance.now(), Math.random)) return;
  const generation = ambientGate.begin();
  if (generation === null) return;
  const availableMotions = motions.value.idle ? Object.keys(motions.value) : null;
  if (availableMotions === null) {
    const state = selectAmbientAction(
      settings.value.mode,
      Math.random(),
      previousAmbientState,
    );
    if (ambientGate.finish(generation)) {
      previousAmbientState = state;
      play(state);
    }
  } else {
    const now = Date.now();
    const availableActions = availableBehaviorActionsForMotions(availableMotions).filter(action => action !== "sleep" || !isBusy(codex.value));
    const context: PetContext = {
      mode: settings.value.mode,
      currentAction: motionActionToBehaviorAction(currentState.value) ?? "idle",
      previousAction: previousBehaviorAction,
      recentActions: recentBehaviorActions,
      secondsSinceLastAmbientAction: Math.max(0, (now - lastAmbientActionAt) / 1_000),
      secondsSinceUserInteraction: Math.max(0, (now - lastUserInteractionAt) / 1_000),
      hour: new Date(now).getHours(),
    };
    const decision = decisionProvider.decide(
      context,
      availableActions,
      Math.random(),
    );
    if (decision instanceof Promise) {
      void decision.then((action) => {
        if (!ambientGate.finish(generation) || disposed ||
          document.visibilityState !== "visible" || pointerStart !== null || !player.isResting) return;
        applyAmbientBehavior(action, Date.now());
      }).catch(() => {
        ambientGate.finish(generation);
        console.warn("行为决策失败，等待下一次本地调度");
      });
    } else {
      if (ambientGate.finish(generation)) {
        decisionTrace?.record({
          provider: "rule", availableActions, selectedAction: decision,
          latencyMs: 0, fallbackReason: null, timestamp: now,
        });
        applyAmbientBehavior(decision, now);
      }
    }
  }
}

function applyAmbientBehavior(behaviorAction: BehaviorAction, now: number): void {
  if (behaviorAction === "sleep" && isBusy(codex.value)) return;
  ambientGate.invalidate();
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

function startAnimationClock(): void {
  lastFrameAt = performance.now();
  animationTimer = window.setInterval(() => {
    scheduleAmbientAction();
    if (document.visibilityState !== "visible") return;
    const now = performance.now();
    const frameDuration = player.snapshot.duration;
    if (now - lastFrameAt < frameDuration) return;
    // Carry the fractional tick remainder so 40–60ms inbetweens do not each
    // become two 32ms ticks. After a stall, resume without skipping poses.
    lastFrameAt = Math.max(lastFrameAt + frameDuration, now - 16);
    const before = player.snapshot;
    player.advance();
    const command = sleepSession.observeAdvance(before, player.snapshot);
    if (command === "sleep" || command === "sleep-exit") player.replace(command);
    else if (command === "complete") player.reset();
    syncMotion();
  }, 16);
}

async function activateSkin(id: string, persist = true, notify = true): Promise<void> {
  ambientGate.invalidate();
  const skin = skins.value.find((candidate) => candidate.id === id) ?? BUILTIN_SKIN;
  const epoch = ++skinLoadEpoch;
  skinLoading = true;
  scheduleAmbientAction();
  try {
    const image = await preloadSkin(skin);
    let loaded: LoadedMotions = {};
    if (skin.id === BUILTIN_SKIN.id) {
      try {
        builtinMotionLoad ??= loadBuiltinMotions(motionManifest, window.devicePixelRatio);
        loaded = await builtinMotionLoad;
      } catch (error) {
        builtinMotionLoad = undefined;
        // A failed refresh must not replace a working cat with a different
        // fallback pose family. Startup can still use the standard v2 atlas.
        if (atlasImage.value !== null && motions.value.idle) throw error;
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
    if (skin.id === BUILTIN_SKIN.id && !loaded.belly) {
      showStatus("扩展动作未就绪，使用标准皮肤");
    } else if (notify) {
      showStatus(`已切换为${skin.displayName}`);
    }
  } catch (error) {
    if (disposed || epoch !== skinLoadEpoch) return;
    console.error("皮肤加载失败", error);
    if (atlasImage.value !== null) {
      showStatus("皮肤加载失败，保留当前外观");
      return;
    }
    if (skin.id !== BUILTIN_SKIN.id) await activateSkin(BUILTIN_SKIN.id, false);
    showStatus("皮肤无效，已使用鳌拜");
  } finally {
    if (epoch === skinLoadEpoch) {
      skinLoading = false;
      scheduleAmbientAction();
    }
  }
}

async function reloadSkins(showResult = true): Promise<void> {
  try {
    const result = await scanSkins();
    skins.value = result.skins;
    await activateSkin(settings.value.selectedSkinId, false, showResult);
    if (showResult) showStatus(result.warnings.length ? `已载入 ${result.skins.length} 个，部分无效` : `已载入 ${result.skins.length} 个皮肤`);
  } catch (error) {
    console.error("扫描皮肤失败", error);
    skins.value = [BUILTIN_SKIN];
    await activateSkin(BUILTIN_SKIN.id, false);
    showStatus("skin 目录读取失败");
  }
}

function persistSoon(): void {
  if (saveTimer !== undefined) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const snapshot = settings.value;
    settingsSaveChain = settingsSaveChain.then(() => saveSettings(snapshot)).catch((error: unknown) => {
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
  showStatus(`${({ quiet: "安静", normal: "普通", active: "活跃" })[mode]}模式`);
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
  syncMotion();
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
  syncMotion();
}

function onKeyboardPet(event: KeyboardEvent): void {
  if (event.repeat) return;
  lastUserInteractionAt = Date.now();
  cancelSleepSession();
  player.press(); player.release(); syncMotion();
  lastFrameAt = performance.now();
}

async function handleMenuAction(action: ContextMenuAction): Promise<void> {
  if (action.startsWith("codex:")) {
    if (codexOperationPending) return;
    codexOperationPending = true;
    try {
      if (action === "codex:toggle") acceptCodex(await setCodexEnabled(!codex.value.enabled));
      else if (action.startsWith("codex:open:")) await openCodexTask(action.slice(11));
      else if (action.startsWith("codex:ack:")) await acknowledgeCodex(action.slice(10));
    } catch { showStatus("Codex 操作失败，提醒已保留"); }
    finally { codexOperationPending = false; }
    return;
  }
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
  if (action === "jev:toggle-enabled") {
    const epoch = ++jevOperationEpoch;
    jevConnectionEpoch++;
    if (!jevStatus.value.configured) {
      showStatus("请先从剪贴板粘贴 API Key");
      return;
    }
    const nextEnabled = !jevStatus.value.enabled;
    try {
      await setJevEnabled(nextEnabled);
      if (epoch !== jevOperationEpoch) return;
      settings.value = { ...settings.value, jevEnabled: nextEnabled };
      const status = await refreshJevStatus(epoch);
      if (epoch !== jevOperationEpoch) return;
      showStatus(status?.enabled === nextEnabled ? (nextEnabled ? "已开启 Jev 决策" : "已切回本地规则") : "Jev 状态未更新");
    } catch {
      if (epoch !== jevOperationEpoch) return;
      showStatus("操作失败");
    }
    return;
  }
  if (action === "jev:paste-key") {
    const epoch = ++jevOperationEpoch;
    jevConnectionEpoch++;
    let clipText = "";
    try {
      // Keep the credential-operation epoch before focusing: a later delete or
      // toggle must still cancel this paste while the window is being shown.
      await focusPetWindow();
      if (epoch !== jevOperationEpoch) return;
      clipText = (await navigator.clipboard.readText()).trim();
    } catch {
      if (epoch !== jevOperationEpoch) return;
      showStatus("无法访问剪贴板，请检查权限");
      return;
    }
    if (epoch !== jevOperationEpoch) return;
    if (!clipText) {
      showStatus("剪贴板内容为空");
      return;
    }
    if (clipText.length < 5 || clipText.length > 512 || /[\r\n\t]/.test(clipText)) {
      showStatus("剪贴板内容格式无效");
      return;
    }
    showStatus("正在验证 API Key...");
    try {
      const pending = verifyAndSaveJevKey(clipText);
      clipText = "";
      const result = await pending;
      if (epoch !== jevOperationEpoch) return;
      jevConnectionEpoch++;
      settings.value = { ...settings.value, jevEnabled: true };
      const status = await refreshJevStatus(epoch);
      if (epoch !== jevOperationEpoch) return;
      if (status?.configured && status.enabled) {
        jevStatus.value = { ...jevStatus.value, connected: true };
        showStatus(`API Key 已配置，连接成功 (${result.latencyMs}ms)`);
      } else if (!status) {
        showStatus("API Key 已保存，但状态读取失败；请重启后测试连接");
      } else if (!status.configured) {
        showStatus("系统凭据保存后不可读取");
      } else {
        showStatus("API Key 已保存，但 Jev 未启用");
      }
    } catch {
      if (epoch !== jevOperationEpoch) return;
      await refreshJevStatus(epoch);
      if (epoch !== jevOperationEpoch) return;
      showStatus(jevStatus.value.credentialError
        ? "系统凭据读取失败，请允许钥匙串访问后测试连接"
        : "API Key 验证或保存失败");
    }
    return;
  }
  if (action === "jev:test-connection") {
    const epoch = ++jevConnectionEpoch;
    const operationEpoch = jevOperationEpoch;
    await refreshJevStatus(operationEpoch, true);
    if (epoch !== jevConnectionEpoch || operationEpoch !== jevOperationEpoch) return;
    if (!jevStatus.value.configured) {
      showStatus(jevStatus.value.credentialError ? "系统凭据读取失败，请允许钥匙串访问后重试" : "未配置 API Key");
      return;
    }
    showStatus("正在测试 Jev 连接...");
    try {
      const result = await testJevConnection();
      if (epoch !== jevConnectionEpoch || operationEpoch !== jevOperationEpoch) return;
      jevStatus.value = { ...jevStatus.value, connected: true };
      showStatus(`Jev 连接正常 (${result.latencyMs}ms)`);
    } catch {
      if (epoch !== jevConnectionEpoch || operationEpoch !== jevOperationEpoch) return;
      jevStatus.value = { ...jevStatus.value, connected: false };
      showStatus("Jev 连接失败");
    }
    return;
  }
  if (action === "jev:delete-key") {
    const epoch = ++jevOperationEpoch;
    jevConnectionEpoch++;
    try {
      await deleteJevKey();
      if (epoch !== jevOperationEpoch) return;
      settings.value = { ...settings.value, jevEnabled: false };
      const status = await refreshJevStatus(epoch);
      if (epoch !== jevOperationEpoch) return;
      jevStatus.value = { ...jevStatus.value, connected: false };
      showStatus(status?.enabled ? "系统凭据已删除；开发环境变量仍在启用 Jev" : "已删除 API Key，已切换为本地规则");
    } catch {
      if (epoch !== jevOperationEpoch) return;
      showStatus("删除失败");
    }
    return;
  }
}

async function openMenu(): Promise<void> {
  cancelInteraction();
  try {
    await showPetContextMenu(
      (action) => void handleMenuAction(action),
      codex.value,
    );
  } catch (error) {
    console.error("打开右键菜单失败", error);
    showStatus("菜单打开失败");
  }
}

onMounted(async () => {
  void startCodexView();
  if (decisionTrace) {
    Object.defineProperty(window, "__AOBAI_DECISION_TRACE__", {
      value: () => decisionTrace.snapshot(), configurable: true,
    });
    Object.defineProperty(window, "__AOBAI_COMPARE_JEV__", {
      value: async () => {
        if (!jevStatus.value.enabled) throw new Error("Jev is disabled");
        const { compareQualityScenarios } = await import("./behavior/qualityScenarios");
        const trace = new DecisionTrace();
        const provider = createBehaviorDecisionProvider("jev", undefined, trace);
        return compareQualityScenarios(provider, trace, ambientGate, () => jevStatus.value.enabled && !disposed);
      },
      configurable: true,
    });
  }
  void refreshJevStatus(jevOperationEpoch);
  const onVisibility = () => {
    if (document.visibilityState !== "visible") {
      cancelInteraction(); player.reset(); syncMotion();
    }
    lastFrameAt = performance.now();
    scheduleAmbientAction();
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

watchEffect(() => {
  const menuSettings = { ...DEFAULT_SETTINGS,
    mode: settings.value.mode, windowLayer: settings.value.windowLayer,
    autostart: settings.value.autostart, selectedSkinId: settings.value.selectedSkinId,
  };
  void syncTrayContextMenu(menuSettings, skins.value, jevStatus.value,
    (action) => void handleMenuAction(action), codex.value).catch(() => {
      console.warn("同步状态栏菜单失败");
    });
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
  clearReminder();
  ambientGate.invalidate();
  if (decisionTrace) Reflect.deleteProperty(window, "__AOBAI_DECISION_TRACE__");
  if (decisionTrace) Reflect.deleteProperty(window, "__AOBAI_COMPARE_JEV__");
  skinLoadEpoch++;
  cancelInteraction();
  if (animationTimer !== undefined) window.clearInterval(animationTimer);
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
    <div v-if="codexReminder" class="codex-reminder" :class="{ 'is-fading': reminderFading }" role="status" @pointerdown.stop @pointerup.stop @contextmenu.stop>
      <button class="codex-open" @click.stop="handleMenuAction(`codex:open:${codexReminder.taskId}`)" :title="`打开 Codex 会话：${noticeText(codexReminder)}`"><span class="codex-label">{{ noticeSpeech(codexReminder) }}</span><small class="codex-project">{{ codexReminder.project }}</small><small v-if="codex.notices.length > 1">另有 {{ codex.notices.length - 1 }} 条 · 托盘查看</small></button>
      <button class="codex-dismiss" aria-label="标为已读" @click.stop="handleMenuAction(`codex:ack:${codexReminder.key}`)">×</button>
    </div>
    <div v-if="statusText && !codexReminder" class="speech-bubble" role="status">{{ statusText }}</div>

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

  </main>
</template>
