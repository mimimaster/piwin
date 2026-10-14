/**
 * Inline subagent inspector: toggle, Host permission, and dense-preview data.
 * Observation only — it never opens the child session.
 */
import { useCallback, useMemo } from 'react';
import type { PermissionDecision, PermissionRememberScope } from '@piwin/contracts';
import type { ChatUiAction, ChatUiState, PermissionPromptUi } from '../chat-reducer';
import { createGestureIdempotencyKey } from '../gesture-idempotency.js';
import type { HostClient } from '../host-client';
import { hostFailureNotice } from '../host-problem-copy.js';
import type { DesktopLocale } from '../desktop-locale';
import type { ModelOption } from '../model-options';
import { pushError, type NotificationAction } from '../notification-queue';
import type { DesktopPreferences } from '../ui-preferences';
import {
  useSubagentSessionInspector,
  type SubagentInspectorController,
} from './use-subagent-session-inspector';
import type {
  SubagentInspectorPanelData,
  SubagentInspectorToggle,
} from '../subagent-inspector-context';
import type { SubagentInspectorSelection } from '../subagent-activity-model';
import { backendOptionForDecision, backendPermissionOptions } from '../backend-permission-options.js';
import type { Dispatch } from 'react';

export type UseWorkbenchSubagentInspectorArgs = {
  hostClient: HostClient;
  state: ChatUiState;
  dispatch: Dispatch<ChatUiAction>;
  dispatchNotification: Dispatch<NotificationAction>;
  desktopLocale: DesktopLocale;
  modelOptions: readonly ModelOption[];
  preferences: DesktopPreferences;
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
  } = args;

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
      const backendOptions = backendPermissionOptions(prompt.context);
      const backendOption =
        backendOptions !== undefined
          ? backendOptionForDecision(backendOptions, decision, rememberScope)
          : undefined;
      const response = await hostClient.request(
        {
          type: 'permission/resolve',
          requestId: prompt.requestId,
          decision,
          ...(backendOption !== undefined
            ? { backendOptionId: backendOption.optionId }
            : decision === 'allow' && rememberScope
              ? { rememberScope }
              : {}),
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
      onPermission: (prompt, decision, rememberScope) => {
        void handleSubagentPermission(prompt, decision, rememberScope);
      },
      onRetry: inspector.retryLoad,
      onClose: inspector.closeInspector,
    }),
    [
      inspector.status,
      inspector.messages,
      inspector.liveTail,
      inspector.loading,
      inspector.error,
      inspector.retryLoad,
      inspector.closeInspector,
      subagentInspectorChild,
      inspectorInvocation,
      modelOptions,
      preferences.verboseAgentChat,
      handleSubagentPermission,
    ],
  );

  return {
    handleInspectSubagent,
    subagentInspectorToggle,
    subagentInspectorPanel,
    inspector,
  };
}
