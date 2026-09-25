/**
 * Which side-chat session each right-panel side-chat tab shows.
 *
 * A side chat is an ordinary Host session rendered in the right panel. This
 * registry is the one place that knows the tab → session binding, so three
 * consumers agree: the panel (what to render), live push subscriptions (the
 * Host filters high-rate session pushes to subscribed ids), and tab close
 * (which session to stop and archive).
 */
import { useSyncExternalStore } from 'react';

type Listener = () => void;

const bindings = new Map<string, string>();
const listeners = new Set<Listener>();
let snapshot: readonly string[] = [];

function bindingKey(mainSessionId: string, tabId: string): string {
  return `${mainSessionId}\u0000${tabId}`;
}

function publish(): void {
  snapshot = [...new Set(bindings.values())].sort();
  for (const listener of listeners) listener();
}

export function getSideChatBinding(mainSessionId: string, tabId: string): string | undefined {
  return bindings.get(bindingKey(mainSessionId, tabId));
}

export function bindSideChat(mainSessionId: string, tabId: string, sideChatSessionId: string): void {
  const key = bindingKey(mainSessionId, tabId);
  if (bindings.get(key) === sideChatSessionId) return;
  bindings.set(key, sideChatSessionId);
  publish();
}

/** Remove and return the binding for a tab (tab closed). */
export function takeSideChatBinding(mainSessionId: string, tabId: string): string | undefined {
  const key = bindingKey(mainSessionId, tabId);
  const sideChatSessionId = bindings.get(key);
  if (sideChatSessionId === undefined) return undefined;
  bindings.delete(key);
  publish();
  return sideChatSessionId;
}

/** Side chats already shown by another tab, so a new tab does not reuse them. */
export function boundSideChatIds(): ReadonlySet<string> {
  return new Set(bindings.values());
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Side-chat session ids that must receive live pushes. Stable across renders. */
export function useSideChatLiveSessionIds(): readonly string[] {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

export function resetSideChatBindingsForTests(): void {
  bindings.clear();
  publish();
}
