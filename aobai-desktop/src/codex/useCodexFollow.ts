import { ref, shallowRef } from "vue";
import { getCodexStatus, listenCodex } from "./desktop";
import { EMPTY_CODEX, newerSnapshot, primaryNotice, noticeSpeech, isConfirmedNotice, type CodexNotice, type CodexSnapshot } from "./model";

/** Owns the transient bubble; unread notices remain in the backend. */
export function useCodexFollow(onUnavailable: () => void) {
  const codex = shallowRef<CodexSnapshot>(EMPTY_CODEX);
  const reminder = shallowRef<CodexNotice>();
  const fading = ref(false);
  const speech = ref("");
  const seen = new Set<string>();
  let timer: number | undefined;
  let removalTimer: number | undefined;
  let disposed = false;
  let unlisten: (() => void) | undefined;

  function clear(): void {
    window.clearTimeout(timer);
    window.clearTimeout(removalTimer);
    reminder.value = undefined;
    speech.value = "";
    fading.value = false;
  }
  function accept(snapshot: CodexSnapshot): void {
    if (disposed || newerSnapshot(codex.value, snapshot) !== snapshot) return;
    codex.value = snapshot;
    if (!snapshot.enabled) { clear(); return; }
    if (reminder.value && (!snapshot.notices.some(n => n.key === reminder.value?.key) ||
      !isConfirmedNotice(snapshot, reminder.value))) clear();
    // Retained notifications can outlive their turn or the bounded task snapshot.
    // Wait for a matching current state before turning one into a new bubble.
    const fresh = snapshot.notices.filter(n => !seen.has(n.key) && isConfirmedNotice(snapshot, n));
    for (const n of fresh) seen.add(n.key);
    while (seen.size > 256) seen.delete(seen.values().next().value!);
    const next = primaryNotice({ ...snapshot, notices: fresh });
    if (!next) return;
    clear();
    reminder.value = next;
    speech.value = noticeSpeech(next);
    timer = window.setTimeout(() => {
      fading.value = true;
      removalTimer = window.setTimeout(clear, 300);
    }, 4_000);
  }
  async function start(): Promise<void> {
    try {
      const stop = await listenCodex(accept);
      if (disposed) { stop(); return; }
      unlisten = stop;
      accept(await getCodexStatus());
    } catch { if (!disposed) onUnavailable(); }
  }
  function dispose(): void {
    disposed = true;
    clear();
    unlisten?.();
  }
  return { codex, reminder, fading, speech, accept, start, dispose };
}
