import { BEHAVIOR_ACTIONS, type BehaviorAction } from "./actions";

export type TraceProvider = "rule" | "jev" | "fallback";
export type FallbackReason =
  | "timeout" | "unauthorized" | "rate_limited" | "server_error"
  | "network_error" | "malformed_response" | "unavailable_action" | "other";

export interface DecisionTraceEntry {
  readonly provider: TraceProvider;
  readonly availableActions: readonly BehaviorAction[];
  readonly selectedAction: BehaviorAction;
  readonly latencyMs: number;
  readonly fallbackReason: FallbackReason | null;
  readonly timestamp: number;
}

const MAX_ENTRIES = 20;
const FALLBACK_REASONS: readonly FallbackReason[] = [
  "timeout", "unauthorized", "rate_limited", "server_error",
  "network_error", "malformed_response", "unavailable_action", "other",
];

function isAction(value: unknown): value is BehaviorAction {
  return BEHAVIOR_ACTIONS.some((action) => action === value);
}

/** Keeps only fixed, non-sensitive fields in memory for the current dev session. */
export class DecisionTrace {
  private readonly entries: DecisionTraceEntry[] = [];

  record(entry: DecisionTraceEntry): void {
    if (!isAction(entry.selectedAction)) return;
    const safe: DecisionTraceEntry = {
      provider: entry.provider === "jev" || entry.provider === "fallback" ? entry.provider : "rule",
      availableActions: (Array.isArray(entry.availableActions) ? entry.availableActions : [])
        .filter(isAction).slice(0, BEHAVIOR_ACTIONS.length),
      selectedAction: entry.selectedAction,
      latencyMs: Number.isFinite(entry.latencyMs) ? Math.max(0, Math.round(entry.latencyMs)) : 0,
      fallbackReason: entry.provider === "fallback" &&
        FALLBACK_REASONS.some((reason) => reason === entry.fallbackReason)
        ? entry.fallbackReason : entry.provider === "fallback" ? "other" : null,
      timestamp: Number.isFinite(entry.timestamp) ? entry.timestamp : Date.now(),
    };
    this.entries.push(safe);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
  }

  snapshot(): readonly DecisionTraceEntry[] {
    return this.entries.map((entry) => ({ ...entry, availableActions: [...entry.availableActions] }));
  }
}

export function classifyFallback(error: unknown): FallbackReason {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/超时|timeout/i.test(message)) return "timeout";
  if (/401|403/.test(message)) return "unauthorized";
  if (/429/.test(message)) return "rate_limited";
  if (/\b5\d\d\b/.test(message)) return "server_error";
  if (/网络|network/i.test(message)) return "network_error";
  if (/格式|response/i.test(message)) return "malformed_response";
  if (/动作|action/i.test(message)) return "unavailable_action";
  return "other";
}
