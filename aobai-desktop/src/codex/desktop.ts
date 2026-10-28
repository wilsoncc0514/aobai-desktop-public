import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { EMPTY_CODEX, type CodexSnapshot } from "./model";
export async function getCodexStatus(): Promise<CodexSnapshot> { return isTauri() ? invoke("get_codex_status") : EMPTY_CODEX; }
export async function setCodexEnabled(enabled: boolean): Promise<CodexSnapshot> { return isTauri() ? invoke("codex_set_enabled", { enabled }) : EMPTY_CODEX; }
export async function refreshCodex(): Promise<void> { if (isTauri()) await invoke("codex_refresh"); }
export async function openCodexTask(id: string): Promise<void> { if (isTauri()) await invoke("codex_open_task", { id }); }
export async function acknowledgeCodex(key: string): Promise<void> { if (isTauri()) await invoke("codex_acknowledge", { key }); }
export async function listenCodex(handler: (snapshot: CodexSnapshot) => void): Promise<UnlistenFn> {
  return isTauri() ? listen<CodexSnapshot>("codex-status", e => handler(e.payload)) : () => undefined;
}
