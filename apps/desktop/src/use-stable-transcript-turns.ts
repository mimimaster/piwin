import { useMemo, useRef } from 'react';
import type { ChatMessageUi } from './chat-reducer.js';
import {
  EMPTY_TRANSCRIPT_TURN_ID_REGISTRY,
  groupTranscriptTurns,
  registerTranscriptTurnIds,
  type TranscriptTurn,
  type TranscriptTurnIdRegistry,
} from './transcript-turns.js';

/**
 * Turns whose ids survive history paging: a page that prepends to (or a window
 * trim that evicts from) a turn leaves the turn it belongs to unchanged.
 *
 * The registry is derived only from the previous grouping, so recomputing on
 * the same messages (StrictMode double render) yields the same ids. Message ids
 * are unique across sessions, so switching sessions needs no explicit reset.
 */
export function useStableTranscriptTurns(
  messages: readonly ChatMessageUi[],
): TranscriptTurn[] {
  const registryRef = useRef<TranscriptTurnIdRegistry>(EMPTY_TRANSCRIPT_TURN_ID_REGISTRY);
  return useMemo(() => {
    const turns = groupTranscriptTurns(messages, registryRef.current);
    registryRef.current = registerTranscriptTurnIds(turns);
    return turns;
  }, [messages]);
}
