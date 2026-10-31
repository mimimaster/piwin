/**
 * Session-scoped native backend questions. Pushes may land for any session;
 * the composer only shows the active session's request.
 */
import { useCallback, useRef, useState } from 'react';
import type { BackendUserInputRequest } from '@piwin/contracts';

export type BackendUserInputPromptState = {
  sessionId: string;
  requestId: string;
  generationId: string;
  request: BackendUserInputRequest;
  runId?: string;
};

export type BackendUserInputController = {
  backendUserInput: BackendUserInputPromptState | null;
  showBackendUserInput: (prompt: BackendUserInputPromptState) => void;
  clearBackendUserInput: (requestId?: string) => boolean;
  clearBackendUserInputForSession: (sessionId: string) => void;
};

export function useBackendUserInput(activeSessionId: string | null): BackendUserInputController {
  const [bySession, setBySession] = useState<Record<string, BackendUserInputPromptState>>({});
  const bySessionRef = useRef(bySession);
  bySessionRef.current = bySession;

  const showBackendUserInput = useCallback((prompt: BackendUserInputPromptState): void => {
    setBySession((current) => ({ ...current, [prompt.sessionId]: prompt }));
  }, []);

  const clearBackendUserInput = useCallback((requestId?: string): boolean => {
    const current = bySessionRef.current;
    const match = Object.values(current).find((prompt) => prompt.requestId === requestId)
      ?? (activeSessionId === null ? undefined : current[activeSessionId]);
    if (match === undefined || (requestId !== undefined && match.requestId !== requestId)) {
      return false;
    }
    setBySession((latest) => {
      if (latest[match.sessionId]?.requestId !== match.requestId) return latest;
      const next = { ...latest };
      delete next[match.sessionId];
      return next;
    });
    return true;
  }, [activeSessionId]);

  const clearBackendUserInputForSession = useCallback((sessionId: string): void => {
    setBySession((current) => {
      if (current[sessionId] === undefined) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
  }, []);

  return {
    backendUserInput: activeSessionId === null ? null : bySession[activeSessionId] ?? null,
    showBackendUserInput,
    clearBackendUserInput,
    clearBackendUserInputForSession,
  };
}
