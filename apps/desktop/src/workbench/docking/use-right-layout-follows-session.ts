import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { readSessionKeyedValue, writeSessionKeyedValue } from '../../session/session-keyed-memory.js';
import type { WorkspaceIdFactory } from './ids.js';
import {
  captureRightLayout,
  parseRightLayoutSnapshot,
  restoreRightLayout,
} from './right-layout-snapshot.js';
import type { WorkspaceState } from './types.js';

export const RIGHT_LAYOUT_BY_SESSION_STORAGE_KEY = 'piwin.desktop.workspaceRight.bySession.v1';

/**
 * Swap the right group's tools when the conversation changes.
 *
 * A session with a remembered layout gets it back. A session without one
 * (a new conversation) keeps what is showing, i.e. the layout of the last
 * session in this project — it diverges from there on its own.
 */
export function useRightLayoutFollowsSession(args: {
  /** False until the project's workspace layout has been loaded. */
  ready: boolean;
  /** The project whose workspace is loaded; a switch re-applies the session's layout. */
  scopeKey: string | undefined;
  sessionId: string | null;
  state: WorkspaceState;
  setState: Dispatch<SetStateAction<WorkspaceState>>;
  createId: WorkspaceIdFactory;
}): void {
  const { ready, scopeKey, sessionId, state, setState, createId } = args;
  const followKey = `${scopeKey ?? ''}\u0000${sessionId ?? ''}`;
  const followedKeyRef = useRef<string | null>(null);
  const lastWrittenRef = useRef<string | null>(null);

  // Declared before the writer: the restore must read the new session's
  // memory before the writer records the outgoing layout under its id.
  useEffect(() => {
    if (!ready || followedKeyRef.current === followKey) return;
    followedKeyRef.current = followKey;
    lastWrittenRef.current = null;
    if (sessionId === null) return;
    const snapshot = readSessionKeyedValue(
      RIGHT_LAYOUT_BY_SESSION_STORAGE_KEY,
      sessionId,
      parseRightLayoutSnapshot,
    );
    if (!snapshot) return;
    setState((current) =>
      JSON.stringify(captureRightLayout(current)) === JSON.stringify(snapshot)
        ? current
        : restoreRightLayout(current, snapshot, createId),
    );
  }, [createId, followKey, ready, sessionId, setState]);

  useEffect(() => {
    if (!ready || sessionId === null || followedKeyRef.current !== followKey) return;
    const serialized = JSON.stringify(captureRightLayout(state));
    if (serialized === lastWrittenRef.current) return;
    lastWrittenRef.current = serialized;
    writeSessionKeyedValue(
      RIGHT_LAYOUT_BY_SESSION_STORAGE_KEY,
      sessionId,
      JSON.parse(serialized) as unknown,
    );
  }, [followKey, ready, sessionId, state]);
}
