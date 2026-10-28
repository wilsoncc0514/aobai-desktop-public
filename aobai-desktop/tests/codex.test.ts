import { describe, it, expect } from "vitest";
import { EMPTY_CODEX, isBusy, newerSnapshot, primaryNotice, quotaText, taskSummary, type CodexSnapshot } from "../src/codex/model";
const now = 100000;
const snapshot: CodexSnapshot = { ...EMPTY_CODEX, enabled: true, revision: 2, quotaUpdatedAt: now };
const window = { bucket: "codex", label: "5小时", remainingPercent: 20, durationMins: 300, resetsAt: now + 9000 };
describe("Codex follow", () => {
  it("keeps disabled state after late enabled reply", () => {
    const disabled = { ...EMPTY_CODEX, revision: 4 };
    expect(newerSnapshot(disabled, snapshot)).toBe(disabled);
  });
  it("shows unknown quota instead of zero and avoids stale pace", () => {
    expect(quotaText({ ...window, remainingPercent: null }, snapshot, now)).toContain("暂不可用");
    expect(quotaText(window, snapshot, now + 301)).toContain("暂不可用");
    expect(quotaText(window, { ...snapshot, quotaError: "offline" }, now)).toContain("暂不可用");
    expect(quotaText({ ...window, resetsAt: now }, snapshot, now)).toContain("暂不可用");
  });
  it("computes pace from time remaining without predicting task finish", () => {
    expect(quotaText(window, snapshot, now)).toContain("消耗偏快");
    expect(quotaText({ ...window, remainingPercent: 50 }, snapshot, now)).toContain("节奏适中");
    expect(quotaText({ ...window, remainingPercent: 90 }, snapshot, now)).toContain("有余量");
  });
  it("prioritizes waiting and counts subagents without duplicating parent", () => {
    const s: CodexSnapshot = { ...snapshot, tasks: [
      { id: "a", turnId: "t", project: "x", parentId: null, phase: "running", lastSeen: now },
      { id: "b", turnId: "t", project: "x", parentId: "a", phase: "waiting", lastSeen: now },
    ], notices: [
      { key: "1", taskId: "a", project: "x", kind: "completed", at: now },
      { key: "2", taskId: "b", project: "x", kind: "waiting", at: now },
    ] };
    expect(isBusy(s)).toBe(true);expect(isBusy({ ...s, enabled: false })).toBe(false);
    expect(primaryNotice(s)?.key).toBe("2");expect(taskSummary(s)).toBe("1 进行中 · 1 待处理 · 含 1 子任务");
    expect(primaryNotice({ ...s, enabled: false })).toBeUndefined();
  });
});

it("speaks naturally without confusing child completion with the parent",async()=>{
  const {noticeSpeech}=await import("../src/codex/model");
  const n={key:"k",taskId:"id",project:"项目",kind:"completed",at:1};
  expect(noticeSpeech(n)).toBe("喵，这一轮完成啦！");
  expect(noticeSpeech({...n,parentId:"parent"})).toContain("小帮手");
  expect(noticeSpeech({...n,kind:"waiting"})).toBe("喵，需要你看一下。");
});
