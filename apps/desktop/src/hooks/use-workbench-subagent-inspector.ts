/**
 * Inline subagent inspector: toggle, Host permission/worktree, and panel data.
 * App still owns document/open callbacks; this hook only assembles the provider value.
 */
import { useCallback, useMemo } from 'react';
import type {
  PermissionDecision,
  PermissionRememberScope,
  PiwinConfig,
} from '@piwin/contracts';
import type { ArtifactActionMessage } from '@piwin/artifact';
import type { ArtifactCanvasTarget } from '../artifact-canvas-model';
import type { ChatUiAction, ChatUiState, PermissionPromptUi } from '../chat-reducer';
import { createGestureIdempotencyKey } from '../gesture-idempotency.js';
import type { HostClient } from '../host-client';
import { hostFailureNotice } from '../host-problem-copy.js';
import type { DesktopLocale } from '../desktop-locale';
import type { ModelOption } from '../model-options';
import { pushError, type NotificationAction } from '../notification-queue';
import type { DocumentOpenInput } from '../tool-call-card';
import type { DesktopPreferences } from '../ui-preferences';
import {
  useSubagentSessionInspector,
  type SubagentInspectorController,
} from './use-subagent-session-inspector';
import type {
  SubagentInspectorPanelData,
  SubagentInspectorToggle,
  SubagentWorktreeAction,
} from '../subagent-inspector-context';
import type { SubagentInspectorSelection } from '../subagent-activity-model';
import type { Dispatch } from 'react';

export type UseWorkbenchSubagentInspectorArgs = {
  hostClient: HostClient;
  state: ChatUiState;
  dispatch: Dispatch<ChatUiAction>;
  dispatchNotification: Dispatch<NotificationAction>;
  desktopLocale: DesktopLocale;
  modelOptions: readonly ModelOption[];
  preferences: DesktopPreferences;
  config: PiwinConfig | null;
  requestGit: HostClient['request'];
  handleResumeSession: (sessionId: string) => void | Promise<void>;
  handleOpenDocument: (doc: DocumentOpenInput, target?: 'stage' | 'inspector') => void;
  handleOpenDiff: (absolutePath: string, relativePath?: string) => void;
  handleArtifactAction: (action: ArtifactActionMessage) => void;
  handleOpenArtifactCanvas: (target: ArtifactCanvasTarget) => void;
};

export function useWorkbenchSubagentInspector(args: UseWorkbenchSubagentInspectorArgs): {
  handleInspectSubagent: (selection: SubagentInspectorSelection) => void;
  subagentInspectorToggle: SubagentInspectorToggle;
  subagentInspectorPanel: SubagentInspectorPanelData;
  inspector: SubagentInspectorController;
} {
  const {
    hostClient,
    state,
    dispatch,
    dispatchNotification,
    desktopLocale,
    modelOptions,
    preferences,
    config,
    requestGit,
    handleResumeSession,
    handleOpenDocument,
    handleOpenDiff,
    handleArtifactAction,
    handleOpenArtifactCanvas,
  } = args;

  const handleEnterSubagentSession = useCallback(
    (sessionId: string): void => {
      void handleResumeSession(sessionId);
    },
    [handleResumeSession],
  );
  const inspector = useSubagentSessionInspector({
    hostClient,
    streamFor: useCallback(
      (childSessionId: string) => state.subagentStreams[childSessionId],
      [state.subagentStreams],
    ),
    childFor: useCallback(
      (childSessionId: string) => state.subagentChildren[childSessionId],
      [state.subagentChildren],
    ),
    onOpenFullSession: handleEnterSubagentSession,
  });
  const inspectorInvocation = inspector.selection
    ? Object.values(state.subagentInvocations).find(
        (item) => item.childSessionId === inspector.selection?.childSessionId,
      )
    : undefined;
  const handleInspectSubagent = useCallback(
    (selection: SubagentInspectorSelection): void => {
      const current = inspector.selection;
      if (
        current !== null &&
        current.childSessionId === selection.childSessionId &&
        current.anchorId === selection.anchorId
      ) {
        inspector.closeInspector();
        return;
      }
      inspector.openInspector(selection);
    },
    [inspector.selection, inspector.openInspector, inspector.closeInspector],
  );
  const handleSubagentPermission = useCallback(
    async (
      prompt: PermissionPromptUi,
      decision: PermissionDecision,
      rememberScope?: PermissionRememberScope,
    ): Promise<void> => {
      const response = await hostClient.request(
        {
          type: 'permission/resolve',
          requestId: prompt.requestId,
          decision,
          ...(decision === 'allow' && rememberScope ? { rememberScope } : {}),
        },
        { idempotencyKey: createGestureIdempotencyKey() },
      );
      dispatch({ type: 'permission/clear', requestId: prompt.requestId });
      if (!response.success) {
        dispatchNotification(pushError(hostFailureNotice(response, desktopLocale)));
      }
    },
    [desktopLocale, dispatch, dispatchNotification, hostClient, state.permissionPrompt?.requestId],
  );
  const handleSubagentWorktreeAction = useCallback(
    async (childSessionId: string, action: SubagentWorktreeAction): Promise<void> => {
      const response = await hostClient.request({
        type: 'subagent/worktree-action',
        childSessionId,
        action,
      });
      if (!response.success) throw new Error(response.error);
    },
    [hostClient],
  );
  const subagentInspectorToggle = useMemo<SubagentInspectorToggle>(
    () => ({ selection: inspector.selection, toggle: handleInspectSubagent }),
    [inspector.selection, handleInspectSubagent],
  );
  const subagentInspectorChild = inspector.selection
    ? state.subagentChildren[inspector.selection.childSessionId]
    : undefined;
  const subagentInspectorPanel = useMemo<SubagentInspectorPanelData>(
    () => ({
      status: inspector.status,
      messages: inspector.messages,
      liveTail: inspector.liveTail,
      loading: inspector.loading,
      error: inspector.error,
      ...(subagentInspectorChild ? { child: subagentInspectorChild } : {}),
      ...(inspectorInvocation ? { invocation: inspectorInvocation } : {}),
      ...(modelOptions.length > 0 ? { modelOptions } : {}),
      showThinking: preferences.verboseAgentChat,
      projectPath: subagentInspectorChild?.projectPath ?? null,
      ...(hostClient.supportsCommand('git/diff-file')
        ? { request: requestGit as never }
        : {}),
      ...(hostClient.supportsCommand('git/diff-summary')
        ? { filesChangedRequest: requestGit as never }
        : {}),
      ...(hostClient.supportsCommand('project/read-file')
        ? {
            onOpenFile: (absolutePath: string, relativePath?: string) => {
              handleOpenDocument(
                {
                  title: (relativePath || absolutePath).split(/[\\/]/).pop() || absolutePath,
                  path: absolutePath,
                },
                'inspector',
              );
            },
            onOpenDocument: handleOpenDocument,
          }
        : {}),
      onOpenDiff: handleOpenDiff,
      onArtifactAction: handleArtifactAction,
      onOpenArtifactCanvas: handleOpenArtifactCanvas,
      artifactPreviewEnabled: config?.artifact?.enabled ?? true,
      ...(config?.artifact?.maxBytes !== undefined
        ? { artifactMaxBytes: config.artifact.maxBytes }
        : {}),
      onPermission: (prompt, decision, rememberScope) => {
        void handleSubagentPermission(prompt, decision, rememberScope);
      },
      onOpenFullSession: inspector.openFullSession,
      onRetry: inspector.retryLoad,
      onClose: inspector.closeInspector,
      onWorktreeAction: handleSubagentWorktreeAction,
    }),
    [
      inspector.status,
      inspector.messages,
      inspector.liveTail,
      inspector.loading,
      inspector.error,
      inspector.openFullSession,
      inspector.retryLoad,
      inspector.closeInspector,
      subagentInspectorChild,
      inspectorInvocation,
      modelOptions,
      preferences.verboseAgentChat,
      hostClient,
      requestGit,
      handleOpenDocument,
      handleOpenDiff,
      handleArtifactAction,
      handleOpenArtifactCanvas,
      config?.artifact?.enabled,
      config?.artifact?.maxBytes,
      handleSubagentPermission,
      handleSubagentWorktreeAction,
    ],
  );

  return {
    handleInspectSubagent,
    subagentInspectorToggle,
    subagentInspectorPanel,
    inspector,
  };
}
