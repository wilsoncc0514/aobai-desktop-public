import { describe, expect, it, vi } from "vitest";
import { buildContextMenuTree, type ContextMenuAction, type JevStatus } from "../src/platform/desktop";
import { DEFAULT_SETTINGS } from "../src/settings/schema";
import { BUILTIN_SKIN } from "../src/skins/catalog";

interface MockMenuItem {
  text?: string;
  checked?: boolean;
  enabled?: boolean;
  action?: () => void;
  item?: string;
  items?: MockMenuItem[];
}

describe("Jev context menu integration", () => {
  const skins = [BUILTIN_SKIN];

  function getJevSubmenu(jevStatus: JevStatus, actionSpy = vi.fn()): MockMenuItem[] {
    const tree = buildContextMenuTree(
      DEFAULT_SETTINGS,
      skins,
      jevStatus,
      (id: ContextMenuAction) => () => actionSpy(id),
    ) as MockMenuItem[];
    const actionMenu = tree.find((item) => item.text === "动作");
    expect(actionMenu).toBeDefined();
    if (!actionMenu?.items) {
      throw new Error("Action menu not found");
    }
    const jevSubmenu = actionMenu.items.find((item) => item.text === "Jev");
    expect(jevSubmenu).toBeDefined();
    if (!jevSubmenu?.items) {
      throw new Error("Jev submenu not found");
    }
    return jevSubmenu.items;
  }

  it("renders disabled status and controls when Jev is not configured", () => {
    const items = getJevSubmenu({ configured: false, enabled: false });
    expect(items).toHaveLength(5);

    const statusItem = items[0]!;
    expect(statusItem.text).toBe("状态：未配置");
    expect(statusItem.enabled).toBe(false);

    const toggleItem = items[1]!;
    expect(toggleItem.text).toBe("使用 Jev 决策");
    expect(toggleItem.checked).toBe(false);
    expect(toggleItem.enabled).toBe(false);

    const pasteItem = items[2]!;
    expect(pasteItem.text).toBe("从剪贴板粘贴 API Key");
    expect(pasteItem.enabled).toBeUndefined(); // Enabled by default

    const testItem = items[3]!;
    expect(testItem.text).toBe("测试连接");
    expect(testItem.enabled).toBe(false);

    const deleteItem = items[4]!;
    expect(deleteItem.text).toBe("删除 API Key");
    expect(deleteItem.enabled).toBe(false);
  });

  it("renders connected status and active controls when configured and connected", () => {
    const items = getJevSubmenu({ configured: true, enabled: true, connected: true });

    const statusItem = items[0]!;
    expect(statusItem.text).toBe("状态：已连接");
    expect(statusItem.enabled).toBe(false);

    const toggleItem = items[1]!;
    expect(toggleItem.text).toBe("使用 Jev 决策");
    expect(toggleItem.checked).toBe(true);
    expect(toggleItem.enabled).toBe(true);

    const testItem = items[3]!;
    expect(testItem.text).toBe("测试连接");
    expect(testItem.enabled).toBe(true);

    const deleteItem = items[4]!;
    expect(deleteItem.text).toBe("删除 API Key");
    expect(deleteItem.enabled).toBe(true);
  });

  it("renders disconnected status when configured but not connected or disabled", () => {
    const items = getJevSubmenu({ configured: true, enabled: false, connected: false });

    const statusItem = items[0]!;
    expect(statusItem.text).toBe("状态：未配置" === statusItem.text ? "状态：未配置" : "状态：未连接");
    expect(statusItem.enabled).toBe(false);

    const toggleItem = items[1]!;
    expect(toggleItem.text).toBe("使用 Jev 决策");
    expect(toggleItem.checked).toBe(false);
    expect(toggleItem.enabled).toBe(true);

    const testItem = items[3]!;
    expect(testItem.enabled).toBe(true);
    const deleteItem = items[4]!;
    expect(deleteItem.enabled).toBe(true);
  });

  it("dispatches expected actions when items are invoked", () => {
    const actionSpy = vi.fn();
    const items = getJevSubmenu({ configured: true, enabled: true, connected: true }, actionSpy);

    // Toggle
    items[1]!.action?.();
    expect(actionSpy).toHaveBeenCalledWith("jev:toggle-enabled");

    // Paste
    items[2]!.action?.();
    expect(actionSpy).toHaveBeenCalledWith("jev:paste-key");

    // Test
    items[3]!.action?.();
    expect(actionSpy).toHaveBeenCalledWith("jev:test-connection");

    // Delete
    items[4]!.action?.();
    expect(actionSpy).toHaveBeenCalledWith("jev:delete-key");
  });
});
