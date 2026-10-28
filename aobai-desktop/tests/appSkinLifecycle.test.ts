import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Vue from "vue";
import { createRenderer, nextTick, ssrContextKey } from "vue";
import appSource from "../src/App.vue?raw";
import { parse, compileScript } from "@vue/compiler-sfc";
import { compile } from "@vue/compiler-dom";
import App from "../src/App.vue";
import { EMPTY_CODEX } from "../src/codex/model";
import { DEFAULT_SETTINGS } from "../src/settings/schema";

const host = vi.hoisted(() => ({
  selectSkin: null as null | ((id: string) => void),
  preload: vi.fn(),
  draw: vi.fn(),
  mode: "quiet" as "quiet" | "normal",
  rows: [] as number[],
  codexListener: null as null | ((s: import("../src/codex/model").CodexSnapshot) => void),
  jevGet: vi.fn(),
  codexGet: vi.fn(), codexUnlisten: vi.fn(), codexOpen: vi.fn(), codexAck: vi.fn(),
}));

vi.mock("../src/codex/desktop", () => ({
  getCodexStatus: () => host.codexGet(),
  listenCodex: async (handler: typeof host.codexListener) => { host.codexListener=handler; return host.codexUnlisten; },
  openCodexTask: (id: string) => host.codexOpen(id), acknowledgeCodex: (key: string) => host.codexAck(key),
  refreshCodex: async () => undefined, setCodexEnabled: async () => ({}),
}));
vi.mock("../src/platform/desktop", () => {
  const noop = async () => undefined;
  const listen = async () => () => undefined;
  return {
    loadSettings: async () => ({ ...DEFAULT_SETTINGS, mode: host.mode }),
    getJevStatus: () => host.jevGet(),
    getAutostartEnabled: async () => false,
    listenForTraySkin: async (callback: (id: string) => void) => { host.selectSkin = callback; return () => undefined; },
    listenForTrayLayer: listen, listenForTrayMode: listen, listenForTraySkinReload: listen, onWindowMoved: listen,
    applyWindowLayer: noop, restoreWindowPosition: noop, syncTrayContextMenu: noop,
    saveSettings: noop, centerWindow: noop, deleteJevKey: noop, focusPetWindow: noop,
    getWindowPosition: async () => ({ x: 0, y: 0 }), moveWindowTo: noop, hideWindow: noop,
    setAutostartEnabled: noop, setJevEnabled: noop, showPetContextMenu: noop,
    startWindowDrag: noop, testJevConnection: noop, verifyAndSaveJevKey: noop,
  };
});
vi.mock("../src/skins/catalog", () => {
  const builtin = { id: "AllBuy", displayName: "鳌拜", atlasUrl: "builtin", atlasPath: "" };
  return {
    BUILTIN_SKIN: builtin,
    preloadSkin: (skin: { id: string }) => host.preload(skin.id),
    scanSkins: async () => ({ skins: [builtin, ...["a", "b"].map(id => ({ id, displayName: id, atlasUrl: id, atlasPath: "" }))], warnings: [] }),
  };
});
vi.mock("../src/animation/motionAssets", () => ({ loadBuiltinMotions: async () => ({}) }));
vi.mock("../src/animation/atlas", async (original) => ({
  ...await original<typeof import("../src/animation/atlas")>(),
  configureCanvasForDisplay: () => ({}),
  drawAtlasFrame: (_context: unknown, image: unknown, row: number) => { host.draw(image); host.rows.push(row); },
}));

// Vue's host renderer exercises the mounted component and its public tray input
// without pretending this replaces native window/canvas acceptance.
interface Node { type: string; text: string; props: Record<string, unknown>; children: Node[]; parent: Node | null }
const node = (type: string): Node => ({ type, text: "", props: {}, children: [], parent: null });
const renderer = createRenderer<Node, Node>({
  createElement: node, createText: text => ({ ...node("text"), text }), createComment: node,
  setText: (n, text) => { n.text = text; }, setElementText: (n, text) => { n.text = text; },
  parentNode: n => n.parent, nextSibling: () => null,
  insert: (n, parent) => { parent.children.push(n); n.parent = parent; },
  remove: n => { if (n.parent) n.parent.children = n.parent.children.filter(child => child !== n); },
  patchProp: (n, key, _previous, value) => { n.props[key] = value; },
});
// Vitest's Node transform emits an SSR template. Compile the real template for
// this client host, retaining the production setup and event handlers.
const { descriptor } = parse(appSource);
const template = compile(descriptor.template!.content, {
  mode: "function", prefixIdentifiers: true,
  bindingMetadata: compileScript(descriptor, { id: "skin-lifecycle" }).bindings,
});
const ClientApp = { ...App, render: new Function("Vue", template.code)(Vue) };
function mount() {
  app = renderer.createApp(ClientApp);
  app.provide(ssrContextKey, {});
  app.mount(root);
}
let app: ReturnType<typeof renderer.createApp> | undefined;
let root: Node;
const builtinImage = { naturalWidth: 1536, naturalHeight: 2288, id: "builtin" };
async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await nextTick();
  await vi.advanceTimersByTimeAsync(16);
  await nextTick();
}
function text(n: Node): string { return n.text + n.children.map(text).join(""); }
function deferred() {
  let resolve!: (image: typeof builtinImage) => void;
  const promise = new Promise<typeof builtinImage>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers(); host.selectSkin = null; host.draw.mockClear();
  host.mode = "quiet"; host.rows = [];
  host.jevGet.mockReset().mockResolvedValue({configured:false,enabled:false});
  host.codexListener=null;host.codexGet.mockReset().mockResolvedValue(EMPTY_CODEX);
  host.codexUnlisten.mockClear();host.codexOpen.mockReset().mockResolvedValue(undefined);host.codexAck.mockReset().mockResolvedValue(undefined);
  host.preload.mockReset().mockResolvedValue(builtinImage);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubGlobal("window", {
    devicePixelRatio: 1, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    setInterval, clearInterval, setTimeout, clearTimeout,
    requestAnimationFrame: (cb: () => void) => setTimeout(cb, 0), cancelAnimationFrame: clearTimeout,
  });
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("navigator", { userAgent: "test" });
  vi.stubGlobal("Element", class {});
  root = node("root");
});
afterEach(() => { app?.unmount(); app = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("skin handoff from the mounted app", () => {
  it("gives the cat a full rest after a long hold instead of firing an old ambient deadline", async () => {
    host.mode = "normal";
    vi.spyOn(Math, "random").mockReturnValue(0);
    mount(); await flush();
    await vi.advanceTimersByTimeAsync(29_000);
    const stage = root.children[0]!;
    (stage.props.onPointerdown as Function)({ button: 0, pointerId: 1, screenX: 0, screenY: 0, currentTarget: null });
    await vi.advanceTimersByTimeAsync(28_000);
    (stage.props.onPointerup as Function)({ pointerId: 1, currentTarget: null });
    await vi.advanceTimersByTimeAsync(2_000);
    await nextTick();
    host.rows = [];
    await vi.advanceTimersByTimeAsync(10_000);
    expect(host.rows.length).toBeGreaterThan(0);
    expect(new Set(host.rows)).toEqual(new Set([0]));
  });
  it("keeps the last visible cat after a failed skin decode", async () => {
    mount(); await flush();
    expect(host.draw).toHaveBeenLastCalledWith(builtinImage);
    host.preload.mockRejectedValueOnce(new Error("broken image"));
    host.selectSkin!("a"); await flush();
    expect(text(root)).toContain("皮肤加载失败，保留当前外观");
    expect(host.preload.mock.calls.map(call => call[0])).toEqual(["AllBuy", "a"]);
    expect(host.draw).toHaveBeenLastCalledWith(builtinImage);
  });

  it("never displays a late image over the most recently selected skin", async () => {
    mount(); await flush();
    const a = deferred(), b = deferred();
    host.preload.mockImplementation((id: string) => id === "a" ? a.promise : b.promise);
    host.selectSkin!("a"); host.selectSkin!("b");
    const imageB = { ...builtinImage, id: "b" };
    b.resolve(imageB); await flush();
    expect(host.draw).toHaveBeenLastCalledWith(imageB);
    a.resolve({ ...builtinImage, id: "a" }); await flush();
    expect(host.draw).toHaveBeenLastCalledWith(imageB);
    expect(text(root)).toContain("已切换为b");
  });

  it("ignores pending skin results after the app is closed", async () => {
    mount(); await flush();
    const pending = deferred(); host.preload.mockReturnValue(pending.promise);
    host.selectSkin!("a"); app!.unmount(); app = undefined;
    const count = host.draw.mock.calls.length;
    pending.resolve({ ...builtinImage, id: "closed" }); await flush();
    expect(host.draw).toHaveBeenCalledTimes(count);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Codex reminder lifecycle in the mounted pet", () => {
  it("loads and draws the cat while keychain status is still pending",async()=>{
    host.jevGet.mockReturnValue(new Promise(()=>undefined));mount();await flush();
    expect(host.draw).toHaveBeenCalledWith(builtinImage);expect(host.codexListener).not.toBeNull();
  });
  const notice={key:"task:turn:waiting",taskId:"11111111-1111-4111-8111-111111111111",project:"测试项目",kind:"waiting",at:1};
  function find(n:Node,cls:string):Node|undefined {return n.props.class===cls?n:n.children.map(c=>find(c,cls)).find(Boolean);}
  it("shows unread text and opens the intended conversation without requesting a cat action",async()=>{
    mount();await flush();await vi.advanceTimersByTimeAsync(2500);await nextTick();const before=host.rows[host.rows.length - 1];
    host.codexListener?.({...EMPTY_CODEX,revision:2,enabled:true,notices:[notice]});await nextTick();
    expect(text(root)).toContain("测试项目");expect(text(root)).toContain("喵，需要你看一下。");
    const button=find(root,"codex-open");expect(button).toBeDefined();
    (button!.props.onClick as (e:unknown)=>void)({stopPropagation:()=>undefined});await flush();
    expect(host.codexOpen).toHaveBeenCalledWith(notice.taskId);expect(host.rows[host.rows.length - 1]).toBe(before);
    const dismiss=find(root,"codex-dismiss")!;
    (dismiss.props.onClick as (e:unknown)=>void)({stopPropagation:()=>undefined});await flush();expect(host.codexAck).toHaveBeenCalledWith(notice.key);
    app!.unmount();app=undefined;expect(host.codexUnlisten).toHaveBeenCalledOnce();
  });
  it("holds for four seconds, fades without acknowledging, and does not replay the same unread",async()=>{
    mount();await flush();
    host.codexListener?.({...EMPTY_CODEX,revision:2,enabled:true,notices:[notice]});await nextTick();
    await vi.advanceTimersByTimeAsync(3999);await nextTick();
    expect(text(root)).toContain("喵，需要你看一下。");
    await vi.advanceTimersByTimeAsync(1);await nextTick();
    expect(find(root,"codex-reminder is-fading")).toBeDefined();
    expect(text(root)).toContain("喵，需要你看一下。");
    await vi.advanceTimersByTimeAsync(300);await nextTick();
    expect(text(root)).not.toContain("喵，需要你看一下。");expect(host.codexAck).not.toHaveBeenCalled();
    host.codexListener?.({...EMPTY_CODEX,revision:3,enabled:true,notices:[notice]});await nextTick();
    expect(text(root)).not.toContain("喵，需要你看一下。");
  });
  it("resets the full display time for a new notice and cancels timers on close",async()=>{
    mount();await flush();host.codexListener?.({...EMPTY_CODEX,revision:2,enabled:true,notices:[notice]});
    await vi.advanceTimersByTimeAsync(4100);await nextTick();
    const next={...notice,key:"new",kind:"completed"};
    host.codexListener?.({...EMPTY_CODEX,revision:3,enabled:true,notices:[next,notice]});await nextTick();
    await vi.advanceTimersByTimeAsync(3900);await nextTick();expect(text(root)).toContain("喵，这一轮完成啦！");
    app!.unmount();app=undefined;expect(vi.getTimerCount()).toBe(0);
  });
  it("ignores an old startup reply after a newer disabled event",async()=>{
    let resolve!:(s:typeof EMPTY_CODEX)=>void;host.codexGet.mockReturnValue(new Promise(done=>resolve=done));
    mount();await flush();host.codexListener?.({...EMPTY_CODEX,revision:5});
    resolve({...EMPTY_CODEX,revision:1,enabled:true,notices:[notice]});await flush();expect(text(root)).not.toContain("等你处理");
  });
});
