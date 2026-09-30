/**
 * 精简 call-chain preference.
 *
 * One reader-level switch shared by every transcript pane: when on, the
 * 已工作 fold lists segment titles only, and tool rows inside it never open
 * their diff or output on their own. Thinking stays — compact trims what the
 * agent touched, not what it reasoned.
 */
import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'piwin.desktop.workChainCompact';

let compact = readStored();
const listeners = new Set<() => void>();

function readStored(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === 'true';
  } catch {
    // Storage can be unavailable (private window, blocked site data): the
    // switch then lasts for this page only.
    return false;
  }
}

export function isWorkChainCompact(): boolean {
  return compact;
}

export function setWorkChainCompact(next: boolean): void {
  if (next === compact) return;
  compact = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next ? 'true' : 'false');
  } catch {
    // Same as readStored: keep the in-memory value.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useWorkChainCompact(): boolean {
  return useSyncExternalStore(subscribe, isWorkChainCompact, isWorkChainCompact);
}
