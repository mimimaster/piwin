/**
 * Artifact flip-card actions and walkthrough generate/cancel/hydrate.
 * Host commands stay here so App does not own flashcard/walkthrough wiring.
 */
import { useCallback, useEffect, type Dispatch } from 'react';
import { formatError, type WalkthroughArtifact } from '@piwin/contracts';
import type { ArtifactActionMessage } from '@piwin/artifact';
import type { ChatUiAction, ChatUiState } from '../chat-reducer';
import type { HostClient } from '../host-client';
import { pushError, type NotificationAction } from '../notification-queue';
import { showUiNotification } from '@piwin/ui-kit';

export type UseWorkbenchArtifactActionsArgs = {
  hostClient: HostClient;
  state: ChatUiState;
  dispatch: Dispatch<ChatUiAction>;
  dispatchNotification: Dispatch<NotificationAction>;
};

export function useWorkbenchArtifactActions(args: UseWorkbenchArtifactActionsArgs) {
  const { hostClient, state, dispatch, dispatchNotification } = args;

  const handleArtifactAction = useCallback(
    (action: ArtifactActionMessage) => {
      if (action.action === 'flashcard/rate') {
        void hostClient
          .request({
            type: 'flashcards/rate',
            cardId: action.payload.cardId,
            rating: action.payload.rating,
          })
          .then((response) => {
            if (!response.success) {
              dispatchNotification(pushError(`Flashcard rating failed: ${response.error}`));
            }
          });
        return;
      }
      if (action.action === 'flashcard/open-source') {
        void hostClient
          .request({
            type: 'doccards/open-source',
            cardId: action.payload.cardId,
          })
          .then((response) => {
            if (!response.success) {
              dispatchNotification(pushError(`Could not resolve source: ${response.error}`));
              return;
            }
            const result = response.data as { path?: string } | undefined;
            if (result?.path) {
              void import('@tauri-apps/plugin-shell')
                .then(({ open }) => open(result.path as string))
                .catch((error: unknown) => {
                  dispatchNotification(pushError(`Failed to open source file: ${formatError(error)}`));
                });
            }
          });
        return;
      }
      if (action.action === 'composer/propose-text') {
        const text = action.payload.text?.trim();
        if (text) {
          void navigator.clipboard?.writeText(text).catch(() => {});
          showUiNotification({
            message: `已复制追问指令：「${text}」`,
            tone: 'info',
          });
        }
        return;
      }
      if (action.action === 'artifact/download-unsupported') {
        const filename = action.payload.filename?.trim();
        const message = filename
          ? `沙箱内无法下载「${filename}」。请让 Agent 把文件写到工作区，再对路径芯片右键另存为。`
          : '沙箱内无法下载文件。请让 Agent 把文件写到工作区，再对路径芯片右键另存为。';
        showUiNotification({ message, tone: 'warning' });
        dispatchNotification({
          type: 'notify/push',
          notification: { level: 'info', message },
        });
      }
    },
    [hostClient, dispatchNotification],
  );

  const handleGenerateWalkthrough = useCallback(
    (messageId: string, force?: boolean) => {
      if (!state.activeSessionId) return;
      void hostClient
        .request({
          type: 'walkthrough/generate',
          sessionId: state.activeSessionId,
          messageId,
          ...(force ? { force: true } : {}),
        })
        .then((response) => {
          if (!response.success) {
            dispatchNotification(pushError(`Walkthrough generation failed: ${response.error}`));
          }
        });
    },
    [hostClient, state.activeSessionId, dispatchNotification],
  );

  const handleCancelWalkthrough = useCallback(
    (messageId: string, generationId?: string) => {
      if (!state.activeSessionId) return;
      void hostClient
        .request({
          type: 'walkthrough/cancel',
          sessionId: state.activeSessionId,
          messageId,
          ...(generationId !== undefined ? { generationId } : {}),
        })
        .then((response) => {
          if (!response.success) {
            dispatchNotification(pushError(`Walkthrough cancel failed: ${response.error}`));
          }
        });
    },
    [hostClient, state.activeSessionId, dispatchNotification],
  );

  // Hydrate walkthrough artifacts whenever the active session changes.
  // We intentionally do NOT guard on messages.length === 0: session/set fires
  // first (clearing messages), so an early return would skip the hydrate call
  // and the later session/load-messages dispatch doesn't change activeSessionId,
  // meaning the effect would never re-run. The host returns persisted artifacts
  // (empty list when none exist) which we dispatch into the reducer map.
  useEffect(() => {
    if (!state.activeSessionId) return;
    // Wait until transcript hydrate finishes so walkthrough chips attach to the
    // real rows (session switch keeps previous rows painted while awaiting).
    if (state.awaitingTranscript) return;
    if (hostClient.supportsCommand?.('walkthrough/list') === false) return;
    const sessionId = state.activeSessionId;
    const knownMessageIds = state.messages.map((message) => message.id);
    void hostClient
      .request({ type: 'walkthrough/list', sessionId, knownMessageIds })
      .then((response) => {
        if (!response.success) return;
        const data = response.data as { artifacts?: WalkthroughArtifact[] } | undefined;
        if (data?.artifacts) {
          dispatch({ type: 'walkthrough/hydrate', artifacts: data.artifacts });
        }
      });
    // Re-run when session changes or when transcript hydrate completes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeSessionId, state.awaitingTranscript, hostClient]);

  return {
    handleArtifactAction,
    handleGenerateWalkthrough,
    handleCancelWalkthrough,
  };
}
