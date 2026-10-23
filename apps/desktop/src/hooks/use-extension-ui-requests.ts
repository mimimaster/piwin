/**
 * Session-scoped extension-ui question state for the workbench.
 *
 * Pushes land for any session; the composer only ever sees the active
 * session's question, so a background session asking never takes over the
 * conversation the user is looking at.
 */
import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  EMPTY_EXTENSION_UI_REQUESTS,
  listExtensionUiQuestionSessionIds,
  putExtensionUiRequest,
  removeExtensionUiRequestById,
  selectExtensionUiRequest,
  type ExtensionUiRequestRegistry,
  type ExtensionUiRequestState,
} from '../extensions/extension-ui-request-registry';

/** Typed answer drafts belong to one request; switching sessions must not carry text across. */
type ExtensionUiInputDraft = { requestId: string; text: string };

export type ExtensionUiRequestsController = {
  extensionUiRequest: ExtensionUiRequestState | null;
  extensionUiQuestionSessionIds: string[];
  extensionUiInput: string;
  setExtensionUiInput: Dispatch<SetStateAction<string>>;
  showExtensionUiRequest: (request: ExtensionUiRequestState) => void;
  clearExtensionUiRequest: (requestId?: string) => boolean;
  clearExtensionUiRequestForSession: (sessionId: string) => void;
};

export function useExtensionUiRequests(activeSessionId: string | null): ExtensionUiRequestsController {
  const [registry, setRegistry] = useState<ExtensionUiRequestRegistry>(EMPTY_EXTENSION_UI_REQUESTS);
  const [inputDraft, setInputDraft] = useState<ExtensionUiInputDraft | null>(null);
  /**
   * React state can lag behind a push while an extension-ui resolve is in
   * flight. Keep the latest registry synchronously so an old resolve cannot
   * clear the next questionnaire page.
   */
  const registryRef = useRef<ExtensionUiRequestRegistry>(EMPTY_EXTENSION_UI_REQUESTS);
  const commitRegistry = useCallback((next: ExtensionUiRequestRegistry): void => {
    if (next === registryRef.current) return;
    registryRef.current = next;
    setRegistry(next);
  }, []);

  const extensionUiRequest = selectExtensionUiRequest(registry, activeSessionId);
  const activeRequestId = extensionUiRequest?.requestId ?? null;
  const activeRequestIdRef = useRef(activeRequestId);
  activeRequestIdRef.current = activeRequestId;

  const showExtensionUiRequest = useCallback(
    (request: ExtensionUiRequestState): void => {
      commitRegistry(putExtensionUiRequest(registryRef.current, request));
    },
    [commitRegistry],
  );

  const clearExtensionUiRequest = useCallback(
    (requestId?: string): boolean => {
      const current = registryRef.current;
      const targetId = requestId ?? activeRequestIdRef.current;
      if (targetId === null) return false;
      const next = removeExtensionUiRequestById(current, targetId);
      if (next === current) return false;
      commitRegistry(next);
      setInputDraft((draft) => (draft?.requestId === targetId ? null : draft));
      return true;
    },
    [commitRegistry],
  );

  const clearExtensionUiRequestForSession = useCallback(
    (sessionId: string): void => {
      const pending = registryRef.current[sessionId];
      if (pending) clearExtensionUiRequest(pending.requestId);
    },
    [clearExtensionUiRequest],
  );

  const setExtensionUiInput = useCallback<Dispatch<SetStateAction<string>>>((update) => {
    const requestId = activeRequestIdRef.current;
    if (requestId === null) return;
    setInputDraft((draft) => {
      const previous = draft?.requestId === requestId ? draft.text : '';
      const text = typeof update === 'function' ? update(previous) : update;
      return { requestId, text };
    });
  }, []);

  const extensionUiInput =
    inputDraft !== null && inputDraft.requestId === activeRequestId ? inputDraft.text : '';
  const extensionUiQuestionSessionIds = useMemo(
    () => listExtensionUiQuestionSessionIds(registry),
    [registry],
  );

  return {
    extensionUiRequest,
    extensionUiQuestionSessionIds,
    extensionUiInput,
    setExtensionUiInput,
    showExtensionUiRequest,
    clearExtensionUiRequest,
    clearExtensionUiRequestForSession,
  };
}
