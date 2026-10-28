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
    await expect(syncTrayContextMenu(DEFAULT_SETTINGS, [], { configured: false, enabled: false }, vi.fn())).rejects.toThrow("synthetic failure");
    expect(failed.close).toHaveBeenCalledOnce();
    expect(first.close).not.toHaveBeenCalled();
    await syncTrayContextMenu(DEFAULT_SETTINGS, [], { configured: false, enabled: false }, vi.fn());
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
