/**
 * Desktop conversation-tree actions (ADR 0055 / 0064): list ‹n/m› points,
 * switch the active branch, retry the same user turn, or resend a changed
 * prompt as a sibling.
 */
import { useCallback, useEffect, useState, type Dispatch } from 'react';
import type {
  HostCommand,
  HostResponse,
  HostServerMessage,
  PromptAttachment,
  PromptContextRef,
  PromptInput,
  SessionBranchListData,
  SessionBranchSwitchData,
  SessionTranscriptMessage,
  SessionTranscriptPageInfo,
  ThinkingLevel,
  PermissionPreset,
  WorkspaceWrites,
} from '@piwin/contracts';
import { readExplicitSkillIntent, toModelRef } from '@piwin/contracts';
import type { TranscriptBranchPoint } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import type { ChatMessageUi, ChatUiAction } from '../chat-reducer';
import type { NotificationAction } from '../notification-queue';
import { pushError, pushInfo } from '../notification-queue';
import { canUseThinkingLevel } from '../model-thinking-policy';
import {
  foregroundMismatchNotice,
  readForegroundProblem,
  requestPromptWithForeground,
} from '../prompt-foreground';
import { createGestureIdempotencyKey } from '../gesture-idempotency.js';
import { clipMessagesAfterId, clipMessagesBeforeId } from '../conversation-branch.js';
import { transcriptOwnerBlocksDangerousAction } from '../transcript-owner-guard';
import type { AgentModeId } from '../agent-mode';
import type { ModelOption } from './use-session-actions';
import type { ForegroundRunMismatchProblem } from '@piwin/contracts';
import type { DesktopLocale } from '../desktop-locale.js';

export type UseBranchActionsArgs = {
  hostClient: Pick<HostClient, 'request' | 'subscribe'> & {
    supportsCommand?: HostClient['supportsCommand'];
    supportsForegroundAdmission?: HostClient['supportsForegroundAdmission'];
  };
  activeSessionId: string | null;
  streaming: boolean;
  projectTrusted: boolean;
  isGeneralScope: boolean;
  transcriptOwnerSessionId: string | null;
  visibleMessages: ChatMessageUi[];
  dispatch: Dispatch<ChatUiAction>;
  dispatchNotification: Dispatch<NotificationAction>;
  setEditingMessageId: Dispatch<string | null>;
  locale: DesktopLocale;
  selectedModelKey: string;
  modelOptions: ModelOption[];
  thinkingLevel?: ThinkingLevel;
  agentMode: AgentModeId;
  permissionPreset?: PermissionPreset;
  orchestrationSchemeId?: string;
  delegationDisabled?: boolean;
  confirmForegroundReplace?: (problem: ForegroundRunMismatchProblem) => Promise<boolean>;
  projectPath?: string | null;
};

export function useBranchActions(args: UseBranchActionsArgs) {
  const {
    hostClient,
    activeSessionId,
    streaming,
    projectTrusted,
    isGeneralScope,
    transcriptOwnerSessionId,
    visibleMessages,
    dispatch,
    dispatchNotification,
    setEditingMessageId,
    locale,
    selectedModelKey,
    modelOptions,
    thinkingLevel,
    agentMode,
    permissionPreset,
    orchestrationSchemeId,
    delegationDisabled,
    confirmForegroundReplace,
    projectPath,
  } = args;

  const [branchPoints, setBranchPoints] = useState<TranscriptBranchPoint[]>([]);
  const [pendingTruncate, setPendingTruncate] = useState<{
    messageId: string;
  } | null>(null);
  const [pendingSwitchConfirm, setPendingSwitchConfirm] = useState<{
    targetMessageId: string;
    offPathWrites: WorkspaceWrites;
  } | null>(null);
  const [pendingRetryDiscard, setPendingRetryDiscard] = useState<{
    userMessageId: string;
    keepPrevious: boolean;
    offPathWrites: WorkspaceWrites;
  } | null>(null);
  const [pendingBranchLeaves, setPendingBranchLeaves] = useState<{
    messageId: string;
    text: string;
    offPathWrites: WorkspaceWrites;
  } | null>(null);

  const refreshBranchPoints = useCallback(
    async (sessionId: string): Promise<void> => {
      if (hostClient.supportsCommand?.('session/branch-list') === false) {
        return;
      }
      const response = await hostClient.request({ type: 'session/branch-list', sessionId });
      if (!response.success) {
        return;
      }
      const data = response.data as SessionBranchListData | undefined;
      if (data?.sessionId === sessionId && Array.isArray(data.branchPoints)) {
        setBranchPoints(data.branchPoints);
      }
    },
    [hostClient],
  );

  useEffect(() => {
    setBranchPoints([]);
    // Pending confirmations name a message id in the session we just left.
    setPendingSwitchConfirm(null);
    setPendingRetryDiscard(null);
    setPendingBranchLeaves(null);
    setPendingTruncate(null);
    if (!activeSessionId) {
      return;
    }
    void refreshBranchPoints(activeSessionId);
  }, [activeSessionId, refreshBranchPoints]);

  useEffect(() => {
    return hostClient.subscribe((message: HostServerMessage) => {
      if (message.type !== 'session/branch-updated') {
        return;
      }
      if (message.sessionId !== activeSessionId) {
        return;
      }
      void refreshBranchPoints(message.sessionId);
    });
  }, [activeSessionId, hostClient, refreshBranchPoints]);

  const applyHostTranscript = useCallback(
    (
      sessionId: string,
      data: { messages?: SessionTranscriptMessage[]; transcriptPage?: SessionTranscriptPageInfo },
    ): void => {
      dispatch({
        type: 'session/branch-switched',
        sessionId,
        messages: data.messages ?? [],
        ...(data.transcriptPage ? { transcriptPage: data.transcriptPage } : {}),
      });
    },
    [dispatch],
  );

  const reloadTranscript = useCallback(
    async (sessionId: string): Promise<void> => {
      const response = await hostClient.request({ type: 'session/messages', sessionId });
      if (!response.success) {
        return;
      }
      const data = response.data as { messages?: SessionTranscriptMessage[] } | undefined;
      applyHostTranscript(sessionId, { messages: data?.messages ?? [] });
    },
    [applyHostTranscript, hostClient],
  );

  const switchBranch = useCallback(
    async (targetMessageId: string, confirm = false): Promise<void> => {
      if (!activeSessionId) {
        dispatchNotification(pushError('No active session to switch.'));
        return;
      }
      if (streaming) {
        dispatchNotification(
          pushInfo('Wait for the current run to finish (or stop it) before switching branches.'),
        );
        return;
      }
      const response = await hostClient.request({
        type: 'session/branch-switch',
        sessionId: activeSessionId,
        targetMessageId,
        messageProjection: 'tail',
        ...(confirm ? { confirm: true } : {}),
      });
      if (!response.success) {
        dispatchNotification(pushError(response.error));
        return;
      }
      const data = response.data as SessionBranchSwitchData;
      if (data.status === 'run-active') {
        dispatchNotification(pushInfo('A run is still active — stop it before switching branches.'));
        return;
      }
      if (data.status === 'needs-confirmation') {
        setPendingSwitchConfirm({
          targetMessageId,
          offPathWrites: data.offPathWrites,
        });
        return;
      }
      setPendingSwitchConfirm(null);
      applyHostTranscript(activeSessionId, data);
      void refreshBranchPoints(activeSessionId);
    },
    [activeSessionId, applyHostTranscript, dispatchNotification, hostClient, refreshBranchPoints, streaming],
  );

  const branchResend = useCallback(
    async (
      messageId: string,
      nextText: string,
      options?: { confirm?: boolean },
    ): Promise<void> => {
      if (!activeSessionId) {
        dispatchNotification(pushError('No active session to branch.'));
        return;
      }
      if (streaming) {
        dispatchNotification(
          pushInfo('Wait for the current run to finish (or stop it) before branching.'),
        );
        return;
      }
      const visible = visibleMessages;
      const target = visible.find((message) => message.id === messageId);
      if (!target || target.role !== 'user') {
        dispatchNotification(pushError(`Cannot branch: message not found in chat (${messageId})`));
        return;
      }
      const text = nextText.trim();
      const attachments = target.attachments;
      const contextRefs = target.contextRefs;
      if (
        !text &&
        attachments.length === 0 &&
        !(contextRefs !== undefined && contextRefs.length > 0)
      ) {
        return;
      }
      if (!isGeneralScope && !projectTrusted) {
        dispatch({ type: 'project/trust-dialog', open: true });
        return;
      }

      setEditingMessageId(null);
      const resendClientMessageId = crypto.randomUUID();
      // The edit card only lets the user change the text; attachments and
      // context refs on the original turn are shown read-only above it and
      // must survive the resend — otherwise "edit this turn" silently drops
      // them from the optimistic bubble and the Host-persisted prompt.
      const skillIntent = readExplicitSkillIntent(text);
      const input = buildBranchPromptInput({
        text,
        branchFromMessageId: messageId,
        clientMessageId: resendClientMessageId,
        agentMode,
        selectedModelKey,
        modelOptions,
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(contextRefs && contextRefs.length > 0 ? { contextRefs } : {}),
        ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
        ...(permissionPreset !== undefined ? { permissionPreset } : {}),
        ...(orchestrationSchemeId !== undefined ? { orchestrationSchemeId } : {}),
        ...(delegationDisabled !== undefined ? { delegationDisabled } : {}),
        ...(skillIntent ? { skillId: skillIntent.skillId } : {}),
      });
      const response = await requestPromptWithForeground({
        request: (command, requestOptions) => hostClient.request(command, requestOptions),
        sessionId: activeSessionId,
        input,
        ...(options?.confirm === true ? { confirm: true } : {}),
        createIdempotencyKey: createGestureIdempotencyKey,
        ...(confirmForegroundReplace ? { confirmReplace: confirmForegroundReplace } : {}),
        ...(typeof hostClient.supportsForegroundAdmission === 'function'
          ? { remoteForegroundAdmission: hostClient.supportsForegroundAdmission() }
          : {}),
      });
      if (!response.success) {
        // No optimistic clip/send yet — write-boundary refusal must leave the
        // visible route unchanged (same invariant as retryTurn).
        const writes = readRouteLeavesWrites(response);
        if (writes && options?.confirm !== true) {
          setPendingBranchLeaves({ messageId, text, offPathWrites: writes });
          return;
        }
        await reloadTranscript(activeSessionId);
        const problem = readForegroundProblem(response);
        if (problem) {
          dispatchNotification(pushError(foregroundMismatchNotice(problem, locale)));
        } else {
          dispatchNotification(pushError(response.error));
        }
        return;
      }
      // Clip + optimistic bubble only after Host accepts.
      if (clipMessagesBeforeId(visible, messageId)) {
        dispatch({
          type: 'session/branch-switched',
          sessionId: activeSessionId,
          clipBeforeMessageId: messageId,
        });
      }
      dispatch({
        type: 'user/send',
        text,
        clientMessageId: resendClientMessageId,
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(contextRefs && contextRefs.length > 0 ? { contextRefs } : {}),
      });
      setPendingBranchLeaves(null);
      const accepted = response.data as { runId?: string; acceptedAt?: string };
      if (typeof accepted.runId === 'string') {
        dispatch({
          type: 'run/accepted',
          runId: accepted.runId,
          ...(accepted.acceptedAt ? { acceptedAt: accepted.acceptedAt } : {}),
        });
      }
      void refreshBranchPoints(activeSessionId);
    },
    [
      activeSessionId,
      agentMode,
      permissionPreset,
      confirmForegroundReplace,
      delegationDisabled,
      dispatch,
      dispatchNotification,
      hostClient,
      isGeneralScope,
      locale,
      modelOptions,
      orchestrationSchemeId,
      projectTrusted,
      refreshBranchPoints,
      reloadTranscript,
      selectedModelKey,
      setEditingMessageId,
      streaming,
      thinkingLevel,
      visibleMessages,
    ],
  );

  const retryTurn = useCallback(
    async (
      userMessageId: string,
      options: { keepPrevious: boolean; confirm?: boolean },
    ): Promise<void> => {
      if (!activeSessionId) {
        dispatchNotification(pushError('No active session to retry.'));
        return;
      }
      if (streaming) {
        dispatchNotification(
          pushInfo('Wait for the current run to finish (or stop it) before retrying.'),
        );
        return;
      }
      const target = visibleMessages.find((message) => message.id === userMessageId);
      if (!target || target.role !== 'user') {
        dispatchNotification(pushError(`Cannot retry: message not found in chat (${userMessageId})`));
        return;
      }
      if (!isGeneralScope && !projectTrusted) {
        dispatch({ type: 'project/trust-dialog', open: true });
        return;
      }

      setEditingMessageId(null);
      const input = buildRetryPromptInput({
        retryUserMessageId: userMessageId,
        keepPrevious: options.keepPrevious,
        agentMode,
        selectedModelKey,
        modelOptions,
        ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
        ...(permissionPreset !== undefined ? { permissionPreset } : {}),
        ...(orchestrationSchemeId !== undefined ? { orchestrationSchemeId } : {}),
        ...(delegationDisabled !== undefined ? { delegationDisabled } : {}),
      });
      const response = await requestPromptWithForeground({
        request: (command, requestOptions) => hostClient.request(command, requestOptions),
        sessionId: activeSessionId,
        input,
        ...(options.confirm === true ? { confirm: true } : {}),
        createIdempotencyKey: createGestureIdempotencyKey,
        ...(confirmForegroundReplace ? { confirmReplace: confirmForegroundReplace } : {}),
        ...(typeof hostClient.supportsForegroundAdmission === 'function'
          ? { remoteForegroundAdmission: hostClient.supportsForegroundAdmission() }
          : {}),
      });
      if (!response.success) {
        const writes = readRetryDiscardsWrites(response);
        if (writes && options.confirm !== true) {
          setPendingRetryDiscard({
            userMessageId,
            keepPrevious: options.keepPrevious,
            offPathWrites: writes,
          });
          return;
        }
        await reloadTranscript(activeSessionId);
        const problem = readForegroundProblem(response);
        if (problem) {
          dispatchNotification(pushError(foregroundMismatchNotice(problem, locale)));
        } else {
          dispatchNotification(pushError(response.error));
        }
        return;
      }
      // Clip only after Host accepts — a write-discard refusal must not flash
      // the previous answer away before the confirm dialog.
      if (clipMessagesAfterId(visibleMessages, userMessageId)) {
        dispatch({
          type: 'session/branch-switched',
          sessionId: activeSessionId,
          clipAfterMessageId: userMessageId,
        });
      }
      setPendingRetryDiscard(null);
      const accepted = response.data as { runId?: string; acceptedAt?: string };
      if (typeof accepted.runId === 'string') {
        dispatch({
          type: 'run/accepted',
          runId: accepted.runId,
          ...(accepted.acceptedAt ? { acceptedAt: accepted.acceptedAt } : {}),
        });
      }
      void refreshBranchPoints(activeSessionId);
    },
    [
      activeSessionId,
      agentMode,
      permissionPreset,
      confirmForegroundReplace,
      delegationDisabled,
      dispatch,
      dispatchNotification,
      hostClient,
      isGeneralScope,
      locale,
      modelOptions,
      orchestrationSchemeId,
      projectTrusted,
      refreshBranchPoints,
      reloadTranscript,
      selectedModelKey,
      setEditingMessageId,
      streaming,
      thinkingLevel,
      visibleMessages,
    ],
  );


  const continueTurn = useCallback(async (): Promise<void> => {
    if (!activeSessionId) {
      dispatchNotification(pushError('No active session to continue.'));
      return;
    }
    if (streaming) {
      dispatchNotification(
        pushInfo('Wait for the current run to finish (or stop it) before continuing.'),
      );
      return;
    }
    if (!isGeneralScope && !projectTrusted) {
      dispatch({ type: 'project/trust-dialog', open: true });
      return;
    }
    setEditingMessageId(null);
    const input = buildContinuePromptInput({
      selectedModelKey,
      modelOptions,
      ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
    });
    const response = await requestPromptWithForeground({
      request: (command, requestOptions) => hostClient.request(command, requestOptions),
      sessionId: activeSessionId,
      input,
      createIdempotencyKey: createGestureIdempotencyKey,
      ...(confirmForegroundReplace ? { confirmReplace: confirmForegroundReplace } : {}),
      ...(typeof hostClient.supportsForegroundAdmission === 'function'
        ? { remoteForegroundAdmission: hostClient.supportsForegroundAdmission() }
        : {}),
    });
    if (!response.success) {
      const problem = readForegroundProblem(response);
      if (problem) {
        dispatchNotification(pushError(foregroundMismatchNotice(problem, locale)));
      } else {
        dispatchNotification(pushError(response.error));
      }
      return;
    }
    const accepted = response.data as { runId?: string; acceptedAt?: string };
    if (typeof accepted.runId === 'string') {
      dispatch({
        type: 'run/accepted',
        runId: accepted.runId,
        ...(accepted.acceptedAt ? { acceptedAt: accepted.acceptedAt } : {}),
      });
    }
    void refreshBranchPoints(activeSessionId);
  }, [
    activeSessionId,
    confirmForegroundReplace,
    dispatch,
    dispatchNotification,
    hostClient,
    isGeneralScope,
    locale,
    modelOptions,
    projectTrusted,
    refreshBranchPoints,
    selectedModelKey,
    setEditingMessageId,
    streaming,
    thinkingLevel,
  ]);

  const requestTruncateAfter = useCallback(
    (messageId: string): void => {
      if (!activeSessionId) {
        return;
      }
      if (streaming) {
        dispatchNotification(
          pushInfo('Wait for the current run to finish (or stop it) before deleting.'),
        );
        return;
      }
      if (
        transcriptOwnerBlocksDangerousAction({
          transcriptOwnerSessionId,
          activeSessionId,
        })
      ) {
        dispatchNotification(
          pushError('Transcript is still loading for this session — try again in a moment.'),
        );
        return;
      }
      setPendingTruncate({ messageId });
    },
    [activeSessionId, dispatchNotification, streaming, transcriptOwnerSessionId],
  );

  const confirmTruncateAfter = useCallback(async (): Promise<void> => {
    if (!activeSessionId || !pendingTruncate) {
      return;
    }
    const messageId = pendingTruncate.messageId;
    setPendingTruncate(null);
    const response = await hostClient.request({
      type: 'session/truncate-from',
      sessionId: activeSessionId,
      messageId,
      messageProjection: 'tail',
    });
    if (!response.success) {
      dispatchNotification(pushError(response.error));
      return;
    }
    const data = response.data as {
      messages?: SessionTranscriptMessage[];
      transcriptPage?: SessionTranscriptPageInfo;
    };
    applyHostTranscript(activeSessionId, data);
    void refreshBranchPoints(activeSessionId);
  }, [
    activeSessionId,
    applyHostTranscript,
    dispatchNotification,
    hostClient,
    pendingTruncate,
    refreshBranchPoints,
  ]);

  return {
    branchPoints,
    switchBranch,
    branchResend,
    retryTurn,
    continueTurn,
    requestTruncateAfter,
    pendingTruncate,
    confirmTruncateAfter,
    cancelTruncateAfter: () => setPendingTruncate(null),
    pendingSwitchConfirm,
    confirmSwitchBranch: () => {
      if (pendingSwitchConfirm) {
        void switchBranch(pendingSwitchConfirm.targetMessageId, true);
      }
    },
    stashThenSwitchBranch: () => {
      const pending = pendingSwitchConfirm;
      if (!pending) {
        return;
      }
      void (async () => {
        if (projectPath) {
          const response = await hostClient.request({
            type: 'git/stash',
            input: { projectPath },
          });
          if (!response.success) {
            dispatchNotification(pushError(response.error));
            return;
          }
        }
        await switchBranch(pending.targetMessageId, true);
      })();
    },
    cancelSwitchBranch: () => setPendingSwitchConfirm(null),
    pendingRetryDiscard,
    confirmRetryDiscard: () => {
      if (pendingRetryDiscard) {
        void retryTurn(pendingRetryDiscard.userMessageId, {
          keepPrevious: pendingRetryDiscard.keepPrevious,
          confirm: true,
        });
      }
    },
    cancelRetryDiscard: () => setPendingRetryDiscard(null),
    pendingBranchLeaves,
    confirmBranchLeaves: () => {
      if (pendingBranchLeaves) {
        void branchResend(pendingBranchLeaves.messageId, pendingBranchLeaves.text, {
          confirm: true,
        });
      }
    },
    cancelBranchLeaves: () => setPendingBranchLeaves(null),
  };
}

export function buildBranchPromptInput(input: {
  text: string;
  branchFromMessageId: string;
  clientMessageId: string;
  agentMode: AgentModeId;
  selectedModelKey: string;
  modelOptions: ModelOption[];
  attachments?: PromptAttachment[];
  contextRefs?: PromptContextRef[];
  thinkingLevel?: ThinkingLevel;
  permissionPreset?: PermissionPreset;
  orchestrationSchemeId?: string;
  delegationDisabled?: boolean;
  skillId?: string;
}): PromptInput {
  const prompt: PromptInput = {
    text: input.text,
    agentMode: input.agentMode,
    clientMessageId: input.clientMessageId,
    branchFromMessageId: input.branchFromMessageId,
  };
  if (input.skillId) {
    prompt.skillId = input.skillId;
  }
  if (input.permissionPreset) {
    prompt.permissionPreset = input.permissionPreset;
  }
  if (input.attachments && input.attachments.length > 0) {
    prompt.attachments = input.attachments;
  }
  if (input.contextRefs && input.contextRefs.length > 0) {
    prompt.contextRefs = input.contextRefs;
  }
  if (input.orchestrationSchemeId && input.orchestrationSchemeId !== 'off') {
    prompt.orchestrationSchemeId = input.orchestrationSchemeId;
  }
  if (input.delegationDisabled) {
    prompt.delegationMode = 'disabled';
  }
  const option = input.modelOptions.find(
    (item) => `${item.providerId}::${item.modelId}` === input.selectedModelKey,
  );
  if (option) {
    prompt.model = toModelRef({
      providerId: option.providerId,
      modelId: option.modelId,
      ...(option.protocol !== undefined ? { protocol: option.protocol } : {}),
    });
    if (
      input.thinkingLevel &&
      canUseThinkingLevel(option, input.thinkingLevel, true)
    ) {
      prompt.thinkingLevel = input.thinkingLevel;
    }
  }
  return prompt;
}

export function buildRetryPromptInput(input: {
  retryUserMessageId: string;
  keepPrevious: boolean;
  agentMode: AgentModeId;
  selectedModelKey: string;
  modelOptions: ModelOption[];
  thinkingLevel?: ThinkingLevel;
  permissionPreset?: PermissionPreset;
  orchestrationSchemeId?: string;
  delegationDisabled?: boolean;
}): PromptInput {
  const prompt: PromptInput = {
    text: '',
    agentMode: input.agentMode,
    retryUserMessageId: input.retryUserMessageId,
  };
  if (input.keepPrevious) {
    prompt.keepPreviousAttempt = true;
  }
  if (input.permissionPreset) {
    prompt.permissionPreset = input.permissionPreset;
  }
  if (input.orchestrationSchemeId && input.orchestrationSchemeId !== 'off') {
    prompt.orchestrationSchemeId = input.orchestrationSchemeId;
  }
  if (input.delegationDisabled) {
    prompt.delegationMode = 'disabled';
  }
  const option = input.modelOptions.find(
    (item) => `${item.providerId}::${item.modelId}` === input.selectedModelKey,
  );
  if (option) {
    prompt.model = toModelRef({
      providerId: option.providerId,
      modelId: option.modelId,
      ...(option.protocol !== undefined ? { protocol: option.protocol } : {}),
    });
    if (input.thinkingLevel && canUseThinkingLevel(option, input.thinkingLevel, true)) {
      prompt.thinkingLevel = input.thinkingLevel;
    }
  }
  return prompt;
}

export function buildContinuePromptInput(input: {
  selectedModelKey: string;
  modelOptions: ModelOption[];
  thinkingLevel?: ThinkingLevel;
}): PromptInput {
  const prompt: PromptInput = {
    text: '',
    source: 'continuation',
  };
  const option = input.modelOptions.find(
    (item) => `${item.providerId}::${item.modelId}` === input.selectedModelKey,
  );
  if (option) {
    prompt.model = toModelRef({
      providerId: option.providerId,
      modelId: option.modelId,
      ...(option.protocol !== undefined ? { protocol: option.protocol } : {}),
    });
    if (input.thinkingLevel && canUseThinkingLevel(option, input.thinkingLevel, true)) {
      prompt.thinkingLevel = input.thinkingLevel;
    }
  }
  return prompt;
}

const ROUTE_LEAVES_WRITE_CODES = new Set(['retry-discards-writes', 'branch-leaves-writes']);

/** Shared Host refusal when leaving a route that wrote workspace files. */
export function readRouteLeavesWrites(response: HostResponse): WorkspaceWrites | undefined {
  if (response.success) {
    return undefined;
  }
  const problem = response.problem;
  if (
    problem?.code === undefined ||
    !ROUTE_LEAVES_WRITE_CODES.has(problem.code) ||
    !problem.data ||
    typeof problem.data !== 'object'
  ) {
    return undefined;
  }
  const data = problem.data as WorkspaceWrites;
  if (!Array.isArray(data.files) || typeof data.hasUnknownWrites !== 'boolean') {
    return undefined;
  }
  return data;
}

/** @deprecated Prefer readRouteLeavesWrites — same payload for retry and branch. */
export function readRetryDiscardsWrites(response: HostResponse): WorkspaceWrites | undefined {
  return readRouteLeavesWrites(response);
}

/** Narrow Host request used by tests — keep the command shape explicit. */
export function isBranchPromptCommand(
  command: HostCommand,
): command is Extract<HostCommand, { type: 'session/prompt' }> {
  return command.type === 'session/prompt';
}

export function readBranchListPoints(response: HostResponse): TranscriptBranchPoint[] {
  if (!response.success) {
    return [];
  }
  const data = response.data as SessionBranchListData | undefined;
  return data?.branchPoints ?? [];
}
