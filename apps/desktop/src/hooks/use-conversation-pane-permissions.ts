/**
 * Permission prompts for one conversation pane. A pane is bound to a single
 * session, so it takes and resolves only that session's prompts: live pushes,
 * the Host's pending list on mount and reconnect, and claims that keep the main
 * bar from offering the same request.
 */
import { useCallback, useEffect, useMemo, useState, type Dispatch } from 'react';
import {
  formatError,
  type HostResponse,
  type HostServerMessage,
  type PermissionDecision,
  type PermissionRememberScope,
} from '@piwin/contracts';
import type { ChatUiAction } from '../chat-reducer';
import type { PermissionPromptUi } from '../chat-ui-types';
import type { HostClient } from '../host-client';
import { toPermissionPromptUi } from '../permission-queue';
import { claimPermissionRequests, releasePermissionClaims } from '../permission-claims';
import { resolvePermissionPrompt } from '../permission-resolve';
import { reconcilePendingPermissions } from './reconcile-pending-permissions';

export type ConversationPanePermissions = {
  /** This session's pending prompts, oldest first. The head is the one the bar shows. */
  prompts: readonly PermissionPromptUi[];
  resolve: (
    prompt: PermissionPromptUi,
    decision: PermissionDecision,
    rememberScope?: PermissionRememberScope,
  ) => Promise<void>;
};

export function useConversationPanePermissions(input: {
  hostClient: HostClient;
  sessionId: string;
  /** The pane reducer's queue; it holds only this session's prompts after filtering. */
  queue: readonly PermissionPromptUi[];
  dispatch: Dispatch<ChatUiAction>;
}): ConversationPanePermissions {
  const { hostClient, sessionId, dispatch } = input;
  const prompts = useMemo(
    () => input.queue.filter((prompt) => prompt.sessionId === sessionId),
    [input.queue, sessionId],
  );
  const requestIds = useMemo(() => prompts.map((prompt) => prompt.requestId), [prompts]);
  // Opaque owner token so claims from this pane never release another pane's claims.
  const [claimOwner] = useState<object>(() => ({}));

  useEffect(() => {
    claimPermissionRequests(claimOwner, requestIds);
  }, [claimOwner, requestIds]);

  useEffect(() => () => releasePermissionClaims(claimOwner), [claimOwner]);

  useEffect(() => {
    void reconcilePendingPermissions({ hostClient, dispatch, sessionId });
    const unsubscribe = hostClient.subscribe((message: HostServerMessage) => {
      if (message.type === 'permission/request' && message.sessionId === sessionId) {
        dispatch({ type: 'permission/show', prompt: toPermissionPromptUi(message) });
      } else if (message.type === 'permission/resolved' && message.sessionId === sessionId) {
        dispatch({ type: 'permission/clear', requestId: message.requestId });
      } else if (message.type === 'host/status' && message.ready) {
        void reconcilePendingPermissions({ hostClient, dispatch, sessionId });
      }
    });
    return () => {
      unsubscribe();
    };
  }, [dispatch, hostClient, sessionId]);

  const resolve = useCallback<ConversationPanePermissions['resolve']>(
    async (prompt, decision, rememberScope = 'once') => {
      let response: HostResponse | null;
      try {
        response = await resolvePermissionPrompt({ hostClient, prompt, decision, rememberScope });
      } catch (error) {
        // Keep the prompt on screen so the user can answer again.
        dispatch({ type: 'error', message: formatError(error) });
        return;
      }
      if (response === null) return;
      dispatch({ type: 'permission/clear', requestId: prompt.requestId });
      if (!response.success) {
        dispatch({ type: 'error', message: response.error });
      }
      void reconcilePendingPermissions({ hostClient, dispatch, sessionId });
    },
    [dispatch, hostClient, sessionId],
  );

  return { prompts, resolve };
}
