/**
 * Which rewritten replies currently show the worker draft instead of the
 * Reply Writer output.
 *
 * The toggle lives on the turn identity header while the rewritten text lives
 * on the turn's last row — often a different, memoized ChatMessageRow — so
 * both read one external store instead of threading state through the turn.
 * View-only and per window: nothing is persisted or sent to Host.
 */
import { useSyncExternalStore } from 'react';

type Listener = () => void;

const sourceShownIds = new Set<string>();
const listeners = new Set<Listener>();

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isReplyWriterSourceShown(messageId: string): boolean {
  return sourceShownIds.has(messageId);
}

export function toggleReplyWriterSource(messageId: string): void {
  if (sourceShownIds.has(messageId)) {
    sourceShownIds.delete(messageId);
  } else {
    sourceShownIds.add(messageId);
  }
  for (const listener of listeners) listener();
}

export function useReplyWriterSourceShown(messageId: string): boolean {
  return useSyncExternalStore(subscribe, () => sourceShownIds.has(messageId));
}
