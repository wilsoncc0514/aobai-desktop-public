import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/settings/schema";

const mocks = vi.hoisted(() => ({
  setMenu: vi.fn(), trayClose: vi.fn(), createMenu: vi.fn(), show: vi.fn(), focus: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/tray", () => ({ TrayIcon: { getById: async () => ({ setMenu: mocks.setMenu, close: mocks.trayClose }) } }));
vi.mock("@tauri-apps/api/window", async (importOriginal) => ({
  ...await importOriginal<typeof import("@tauri-apps/api/window")>(),
  getCurrentWindow: () => ({ show: mocks.show, setFocus: mocks.focus, outerPosition: async()=>({x:0,y:0}),outerSize:async()=>({width:208,height:208}) }),
  currentMonitor: async()=>null,
}));
vi.mock("@tauri-apps/api/menu", () => ({ Menu: { new: mocks.createMenu } }));

describe("shared status bar menu", () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); mocks.setMenu.mockResolvedValue(undefined); mocks.show.mockResolvedValue(undefined); mocks.focus.mockResolvedValue(undefined); });

  it("includes the full pet menu, keeps native show/quit, and forwards Jev actions", async () => {
    const { syncTrayContextMenu } = await import("../src/platform/desktop");
    const menu = { close: vi.fn() };
    mocks.createMenu.mockResolvedValue(menu);
    const action = vi.fn();
    await syncTrayContextMenu(DEFAULT_SETTINGS, [{ id: "AllBuy", displayName: "鳌拜" }], { configured: true, enabled: true }, action);
    const items = mocks.createMenu.mock.calls[0]![0].items;
    expect(items.map((item: { text?: string }) => item.text).filter(Boolean)).toEqual(["显示鳌拜", "外观", "动作", "窗口", "行为", "Codex", "暂时隐藏", "退出"]);
    const jev = items.find((item: { text?: string }) => item.text === "动作").items.find((item: { text?: string }) => item.text === "Jev");
    jev.items[1].action();
    expect(action).toHaveBeenCalledWith("jev:toggle-enabled");
    expect(items[0].id).toBe("show");
    expect(items.at(-1).id).toBe("quit");
    expect(mocks.setMenu).toHaveBeenCalledWith(menu);
    expect(mocks.createMenu.mock.calls[0]![0].id).toBe("pet-tray-menu");
    expect(jev.items[1].id).toBe("pet:jev:toggle-enabled");
    expect(mocks.trayClose).not.toHaveBeenCalled();
  });

  it("shows and focuses the pet before a clipboard read, including after hiding", async () => {
    const { focusPetWindow } = await import("../src/platform/desktop");
    await focusPetWindow();
    expect(mocks.show).toHaveBeenCalledOnce();
    expect(mocks.focus).toHaveBeenCalledOnce();
    expect(mocks.show.mock.invocationCallOrder[0]).toBeLessThan(mocks.focus.mock.invocationCallOrder[0]!);
  });

  it("serializes updates and closes the replaced menu only after installing its successor", async () => {
    const { syncTrayContextMenu } = await import("../src/platform/desktop");
    const first = { close: vi.fn() }, second = { close: vi.fn() };
    mocks.createMenu.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    let finish!: () => void;
    mocks.setMenu.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const update1 = syncTrayContextMenu(DEFAULT_SETTINGS, [], { configured: true, enabled: true }, vi.fn());
    await vi.waitFor(() => expect(mocks.setMenu).toHaveBeenCalledTimes(1));
    const update2 = syncTrayContextMenu({ ...DEFAULT_SETTINGS, mode: "active" }, [], { configured: false, enabled: false }, vi.fn());
    await vi.waitFor(() => expect(mocks.setMenu).toHaveBeenCalledTimes(1));
    expect(first.close).not.toHaveBeenCalled();
    finish();
    await Promise.all([update1, update2]);
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).not.toHaveBeenCalled();
    const items = mocks.createMenu.mock.calls[1]![0].items;
    const modes = items.find((item: { text?: string }) => item.text === "行为").items;
    expect(modes.find((item: { text?: string }) => item.text === "活跃").checked).toBe(true);
  });

  it("cleans a failed replacement, preserves the previous menu, and allows retry", async () => {
    const { syncTrayContextMenu } = await import("../src/platform/desktop");
    const first = { close: vi.fn() }, failed = { close: vi.fn() }, retry = { close: vi.fn() };
    mocks.createMenu.mockResolvedValueOnce(first).mockResolvedValueOnce(failed).mockResolvedValueOnce(retry);
    await syncTrayContextMenu(DEFAULT_SETTINGS, [], { configured: false, enabled: false }, vi.fn());
    mocks.setMenu.mockRejectedValueOnce(new Error("synthetic failure"));
    const changed = { ...DEFAULT_SETTINGS, mode: "active" as const };
    await expect(syncTrayContextMenu(changed, [], { configured: false, enabled: false }, vi.fn())).rejects.toThrow("synthetic failure");
    expect(failed.close).toHaveBeenCalledOnce();
    expect(first.close).not.toHaveBeenCalled();
    await syncTrayContextMenu(changed, [], { configured: false, enabled: false }, vi.fn());
    expect(first.close).toHaveBeenCalledOnce();
    expect(mocks.trayClose).not.toHaveBeenCalled();
  });
});

it("waits for a context popup to close before rebuilding the tray and coalesces pending updates",async()=>{
  vi.resetModules();vi.clearAllMocks();mocks.setMenu.mockResolvedValue(undefined);
  const {showPetContextMenu,syncTrayContextMenu}=await import("../src/platform/desktop");
  let closePopup!:()=>void;const popup=vi.fn(()=>new Promise<void>(resolve=>closePopup=resolve));
  mocks.createMenu.mockResolvedValue({close:vi.fn(),popup});
  const opened=showPetContextMenu(vi.fn());
  await vi.waitFor(()=>expect(popup).toHaveBeenCalledOnce());
  const update1=syncTrayContextMenu(DEFAULT_SETTINGS,[],{configured:false,enabled:false},vi.fn());
  const update2=syncTrayContextMenu({...DEFAULT_SETTINGS,mode:"active"},[],{configured:false,enabled:false},vi.fn());
  await Promise.resolve();expect(mocks.createMenu).toHaveBeenCalledTimes(1);
  closePopup();await Promise.all([opened,update1,update2]);expect(mocks.createMenu).toHaveBeenCalledTimes(2);
  const items=mocks.createMenu.mock.calls[1]![0].items;
  expect(items.find((i:{text?:string})=>i.text==="行为").items.find((i:{text?:string})=>i.text==="活跃").checked).toBe(true);
});

it("keeps settings in the tray while the pet menu contains only task notifications and hide", async()=>{
  const { buildContextMenuTree, buildPetContextMenuTree }=await import("../src/platform/desktop");
  const { EMPTY_CODEX }=await import("../src/codex/model");
  const snapshot={...EMPTY_CODEX,enabled:true,quota:[{bucket:"codex",label:"5小时",remainingPercent:8,durationMins:300,resetsAt:9999999999}]};
  const action=vi.fn(()=>vi.fn());
  const tray=buildContextMenuTree(DEFAULT_SETTINGS,[],{configured:false,enabled:false},action,snapshot);
  const quick=buildPetContextMenuTree(snapshot,action);
  expect(tray.filter(i=>"text" in i).map(i=>i.text)).toEqual(["外观","动作","窗口","行为","Codex","暂时隐藏"]);
  expect(quick.filter(i=>"text" in i).map(i=>i.text)).toEqual(["Codex","暂时隐藏"]);
  expect(JSON.stringify(tray)).not.toMatch(/剩余|刷新额度|配速|5小时|8%/);
});

 it("does not rebuild unchanged rendered menus, but retains the latest action handler", async () => {
  vi.resetModules(); vi.clearAllMocks(); mocks.setMenu.mockResolvedValue(undefined);
  const { syncTrayContextMenu } = await import("../src/platform/desktop");
  const { EMPTY_CODEX } = await import("../src/codex/model");
  mocks.createMenu.mockResolvedValue({ close: vi.fn() });
  const latest = vi.fn();
  await syncTrayContextMenu(DEFAULT_SETTINGS, [], { configured: false, enabled: false }, vi.fn(), EMPTY_CODEX);
  await syncTrayContextMenu(DEFAULT_SETTINGS, [], { configured: false, enabled: false }, latest, { ...EMPTY_CODEX, revision: 99 });
  expect(mocks.createMenu).toHaveBeenCalledOnce();
  const items = mocks.createMenu.mock.calls[0]![0].items;
  items.find((item: { text?: string }) => item.text === "暂时隐藏").action();
  expect(latest).toHaveBeenCalledWith("hide");
});

it("prioritizes waiting notices and groups known children without losing orphan tasks", async () => {
  const { buildPetContextMenuTree } = await import("../src/platform/desktop");
  const { EMPTY_CODEX } = await import("../src/codex/model");
  const action = vi.fn((id: string) => () => id);
  const tasks = [
    { id: "parent-123456", turnId: "a", project: "主项目", parentId: null, phase: "running" as const, lastSeen: 2 },
    { id: "child-123456", turnId: "b", project: "子项目", parentId: "parent-123456", phase: "waiting" as const, lastSeen: 3 },
    { id: "orphan-123456", turnId: "c", project: "孤立", parentId: "missing", phase: "unknown" as const, lastSeen: 1 },
  ];
  const completed = { key: "done", taskId: "parent-123456", project: "主项目", kind: "completed", at: 2 };
  const waiting = { key: "wait", taskId: "child-123456", parentId: "parent-123456", project: "子项目", kind: "waiting", at: 1 };
  const tree = buildPetContextMenuTree({ ...EMPTY_CODEX, enabled: true, tasks, notices: [completed, waiting] }, action);
  type TestMenu = { text?: string; items?: TestMenu[] };
  const menu = (tree[0] as TestMenu).items!;
  const inbox = menu.find(i => i.text?.startsWith("未读提醒"))!;
  expect(inbox.text).toContain("待处理 1");
  expect(inbox.items?.[0]?.text).toContain("等你处理");
  const recent = menu.find(i => i.text === "最近任务")!;
  expect(recent.items?.[0]?.items?.map(i => i.text)).toEqual(["打开主任务 · 主项目 · 进行中 · 123456", "子任务 · 子项目 · 等你处理 · 123456"]);
  expect(recent.items?.[1]?.text).toBe("其他子任务（层级不完整）");
  expect(action).toHaveBeenCalledWith("codex:open:child-123456");
  expect(action).toHaveBeenCalledWith("codex:open:orphan-123456");
});

it("keeps nested and cyclic task relationships reachable without recursion loops", async () => {
  const { buildPetContextMenuTree } = await import("../src/platform/desktop");
  const { EMPTY_CODEX } = await import("../src/codex/model");
  const makeTask = (id: string, parentId: string | null) => ({ id, parentId, turnId: "turn", project: id, phase: "running" as const, lastSeen: 1 });
  const action = vi.fn((id: string) => () => id);
  const snapshot = { ...EMPTY_CODEX, enabled: true, tasks: [
    makeTask("grandchild", "child"), makeTask("child", "root"), makeTask("root", null),
    makeTask("cycle-a", "cycle-b"), makeTask("cycle-b", "cycle-a"),
  ] };
  const tree = buildPetContextMenuTree(snapshot, action);
  type TestMenu = { text?: string; items?: TestMenu[] };
  const items = (tree[0] as TestMenu).items!;
  const tasks = items.find(i => i.text === "最近任务")!.items!;
  expect(tasks[0]?.items?.[1]?.items?.[1]?.text).toContain("grandchild");
  expect(tasks[1]?.text).toBe("其他子任务（层级不完整）");
  for (const id of ["root", "child", "grandchild", "cycle-a", "cycle-b"]) {
    expect(action).toHaveBeenCalledWith(`codex:open:${id}`);
  }
});

it("labels a retained waiting notice as unconfirmed when its task is missing", async () => {
  const { buildPetContextMenuTree } = await import("../src/platform/desktop");
  const { EMPTY_CODEX } = await import("../src/codex/model");
  const waiting = { key: "old", taskId: "missing", project: "项目", kind: "waiting", at: 1 };
  const tree = buildPetContextMenuTree({ ...EMPTY_CODEX, enabled: true, notices: [waiting] }, () => () => undefined);
  type TestMenu = { text?: string; items?: TestMenu[] };
  const inbox = (tree[0] as TestMenu).items!.find(i => i.text?.startsWith("未读提醒"))!;
  expect(inbox.text).toContain("待确认 1");
  expect(inbox.items?.[0]?.text).toContain("状态待确认");
  expect(inbox.items?.[0]?.items?.map(i => i.text)).toEqual(["打开会话", "标为已读"]);
});
