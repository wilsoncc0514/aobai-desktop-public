export type Phase = "running" | "waiting" | "completed" | "interrupted" | "unknown";
export interface CodexTask { id: string; turnId: string; project: string; parentId: string | null; phase: Phase; lastSeen: number }
export interface CodexNotice { parentId?: string | null; key: string; taskId: string; project: string; kind: string; at: number }
export interface QuotaWindow { bucket: string; label: string; remainingPercent: number | null; durationMins: number | null; resetsAt: number | null }
export interface CodexSnapshot { revision: number; enabled: boolean; source: string; message: string; tasks: CodexTask[]; notices: CodexNotice[]; quota: QuotaWindow[]; quotaUpdatedAt: number | null; quotaError: string | null }
export const EMPTY_CODEX: CodexSnapshot = { revision: 0, enabled: false, source: "disabled", message: "未开启任务跟随", tasks: [], notices: [], quota: [], quotaUpdatedAt: null, quotaError: null };
export const PHASE_LABEL: Record<Phase, string> = { running: "进行中", waiting: "等你处理", completed: "已完成", interrupted: "已中断", unknown: "状态未知" };
export function isBusy(snapshot: CodexSnapshot): boolean {
  return snapshot.enabled && snapshot.tasks.some(t => t.phase === "running" || t.phase === "waiting");
}
export function taskSummary(snapshot: CodexSnapshot): string {
  const running = snapshot.tasks.filter(t => t.phase === "running").length;
  const waiting = snapshot.tasks.filter(t => t.phase === "waiting").length;
  const children = snapshot.tasks.filter(t => t.parentId !== null).length;
  return `${running} 进行中 · ${waiting} 待处理${children ? ` · 含 ${children} 子任务` : ""}`;
}
export function quotaText(window: QuotaWindow, snapshot: CodexSnapshot, now: number): string {
  const remaining = window.remainingPercent;
  if (remaining === null || !Number.isFinite(remaining) || snapshot.quotaError || snapshot.quotaUpdatedAt === null || now - snapshot.quotaUpdatedAt > 300 || (window.resetsAt !== null && window.resetsAt <= now)) return `${window.bucket} ${window.label}：暂不可用`;
  let text = `${window.bucket} ${window.label}：余 ${Math.round(remaining)}%`;
  if (window.resetsAt !== null) {
    const mins = Math.max(1, Math.ceil((window.resetsAt - now) / 60));
    text += ` · ${mins >= 60 ? `${Math.floor(mins / 60)}时${mins % 60}分` : `${mins}分`}后重置`;
    if (window.durationMins !== null && window.durationMins > 0) {
      const timeRemaining = Math.min(1, (window.resetsAt - now) / (window.durationMins * 60));
      const pace = remaining / 100 / timeRemaining;
      text += ` · ${pace < 0.85 ? "消耗偏快" : pace > 1.15 ? "有余量" : "节奏适中"}`;
    }
  }
  return text;
}
export function primaryNotice(snapshot: CodexSnapshot): CodexNotice | undefined {
  if (!snapshot.enabled) return undefined;
  return snapshot.notices.find(n => n.kind === "waiting") ?? snapshot.notices[0];
}
export function noticeText(n: CodexNotice): string {
  const subject = n.parentId ? "子任务" : "任务";
  return `${n.project} · ${n.kind === "waiting" ? `${n.parentId ? "子任务" : ""}等你处理` : n.kind === "completed" ? `${subject}完成` : `${subject}中断`}`;
}
// Snapshot reads and event delivery may race. Old replies must not re-enable a disabled feed.
export function newerSnapshot(current: CodexSnapshot, incoming: CodexSnapshot): CodexSnapshot {
  return incoming.revision >= current.revision ? incoming : current;
}

export function noticeSpeech(n: CodexNotice): string {
  if (n.kind === "waiting") return "喵，需要你看一下。";
  if (n.kind === "completed") return n.parentId ? "喵，小帮手完成这一轮啦！" : "喵，这一轮完成啦！";
  return "喵，这一轮中断了。";
}
