/**
 * How the conversation area is drawn: Desktop's own transcript and composer,
 * or the terminal shell on the same session (ADR 0086). A device preference,
 * not session state — both surfaces show the same Host session.
 */
import { useCallback, useState } from 'react';

export type ConversationSurface = 'chat' | 'tui';

export const CONVERSATION_SURFACE_STORAGE_KEY = 'piwin.desktop.conversation-surface';

type SurfaceStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): SurfaceStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    // Storage can be blocked outright; the preference is then per-run.
    return undefined;
  }
}

export function readConversationSurface(
  storage: SurfaceStorage | undefined = defaultStorage(),
): ConversationSurface {
  try {
    return storage?.getItem(CONVERSATION_SURFACE_STORAGE_KEY) === 'tui' ? 'tui' : 'chat';
  } catch {
    return 'chat';
  }
}

export function writeConversationSurface(
  surface: ConversationSurface,
  storage: SurfaceStorage | undefined = defaultStorage(),
): void {
  try {
    storage?.setItem(CONVERSATION_SURFACE_STORAGE_KEY, surface);
  } catch {
    // Quota or privacy mode: the choice still holds for this run.
  }
}

export function useConversationSurface(): [ConversationSurface, (next: ConversationSurface) => void] {
  const [surface, setSurface] = useState<ConversationSurface>(() => readConversationSurface());
  const choose = useCallback((next: ConversationSurface): void => {
    setSurface(next);
    writeConversationSurface(next);
  }, []);
  return [surface, choose];
}
