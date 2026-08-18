/**
 * Project open/trust + session lifecycle + chat ops (edit/retry/abort/compact).
 */
import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type {
  ModelRef,
  PermissionDecision,
  PermissionRememberScope,
  SessionListData,
  SessionListOrder,
  SessionScope,
  SessionSummary,
  SessionTranscriptMessage,
  SessionTranscriptPageInfo,
  SessionTranscriptWindowData,
  SessionUserMessageAnchor,
  SessionUserMessageIndexData,
} from '@piwin/contracts';
import {
  SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
  SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
  SESSION_TRANSCRIPT_WINDOW_DEFAULT_AFTER_ITEMS,
  SESSION_TRANSCRIPT_WINDOW_DEFAULT_BEFORE_ITEMS,
  SESSION_USER_MESSAGE_INDEX_DEFAULT_TICKS,
} from '@piwin/contracts';
import type { HostClient } from '../host-client';
import type { ChatUiAction, ChatUiState, SessionListItemUi } from '../chat-reducer';
import type { NotificationAction } from '../notification-queue';
import { pushError, pushInfo, pushSuccess } from '../notification-queue';
import { appendHostLogEntry, type HostLogEntry } from '../HostLogPanel';
import { type AgentModeId } from '../agent-mode';
import type { SessionRowMenuAction } from '../session-row-menu';
import { isDesktopShellRuntime, pickProjectDirectory } from '../pick-project-directory';
import { summaryToListItem } from './session-list-item';
import { sessionHasListName } from '../title-display';
import { resolveSessionOutline } from '../transcript-outline';
import { canUseThinkingLevel } from '../model-thinking-policy';
import { chooseSessionExportPath } from '../session-export-dialog';
import { forgetTranscriptScrollPosition } from '../transcript-scroll-memory';
import { transcriptOwnerBlocksDangerousAction } from '../transcript-owner-guard';
import { DESKTOP_SESSION_LIST_MAX_ITEMS } from '../session-list-policy';
import { sessionScopeKey } from '../session-scope-key';
import { requestSessionTranscriptPage } from '../session-transcript-page-request';
import {
  mapListedSessionItems,
  sessionListCommandForTransport,
} from '../remote-session-hydrate';
import {
  foregroundMismatchNotice,
  readForegroundProblem,
  requestPromptWithForeground,
} from '../prompt-foreground';
import { useDesktopLocale } from '../desktop-locale-context';
import type { ForegroundRunMismatchProblem } from '@piwin/contracts';

export type ModelOption = {
  providerId: string;
  protocol: 'openai-compatible' | 'anthropic-compatible' | 'google-gemini';
  modelId: string;
  label: string;
  thinkingLevels?: readonly import('@piwin/contracts').ThinkingLevel[];
  reasoning?: boolean;
};

function resolveKnownSessionScope(state: ChatUiState, sessionId: string): SessionScope {
  for (const [projectPath, sessions] of Object.entries(state.projectSessionsByPath)) {
    const session = sessions.find((item) => item.id === sessionId);
    if (session) {
      return session.scope?.kind === 'project' ? session.scope : { kind: 'project', projectPath };
    }
  }
  const generalSession = state.generalSessions.find((item) => item.id === sessionId);
  if (generalSession?.scope) {
    return generalSession.scope;
  }
  if (generalSession) {
    return { kind: 'general' };
  }
  return state.activeScope;
}

export type UseSessionActionsArgs = {
  hostClient: HostClient;
  state: ChatUiState;
  dispatch: Dispatch<ChatUiAction>;
  dispatchNotification: Dispatch<NotificationAction>;
  projectInput: string;
  setProjectInput: Dispatch<SetStateAction<string>>;
  setProjectPickerOpen: Dispatch<SetStateAction<boolean>>;
  showArchivedSessions: boolean;
  sessionListOrder: SessionListOrder;
  /** Resolve bounded search rows that are intentionally absent from resident pages. */
  resolveSessionScopeHint?: (sessionId: string) => SessionScope | undefined;
  selectedModelKey: string;
  modelOptions: ModelOption[];
  thinkingLevel?: import('@piwin/contracts').ThinkingLevel;
  agentMode: AgentModeId;
  orchestrationSchemeId?: string;
  delegationDisabled?: boolean;
  setEditingMessageId: Dispatch<SetStateAction<string | null>>;
  setRenameDraft: Dispatch<SetStateAction<{ sessionId: string; name: string } | null>>;
  setHostLogEntries: Dispatch<SetStateAction<HostLogEntry[]>>;
  /** Restore truncated user text into the composer after Revert (no auto-resend). */
  setComposer: Dispatch<SetStateAction<string>>;
  /**
   * Restore the composer model/thinking when a session is opened or resumed.
   * Host returns the last-used profile from the session index (or transcript).
   */
  onSessionComposerProfileRestored?: (profile: {
    model?: ModelRef;
    thinkingLevel?: import('@piwin/contracts').ThinkingLevel;
  }) => void;
  confirmForegroundReplace?: (problem: ForegroundRunMismatchProblem) => Promise<boolean>;
};

export function useSessionActions(args: UseSessionActionsArgs) {
  const {
    hostClient,
    state,
    dispatch,
    dispatchNotification,
    projectInput,
    setProjectPickerOpen,
    showArchivedSessions,
    sessionListOrder,
    resolveSessionScopeHint,
    selectedModelKey,
    modelOptions,
    thinkingLevel,
    agentMode,
    orchestrationSchemeId,
    delegationDisabled,
    setEditingMessageId,
    setRenameDraft,
    setHostLogEntries,
    setComposer,
    onSessionComposerProfileRestored,
    confirmForegroundReplace,
  } = args;
  const { locale } = useDesktopLocale();
  // Multiple event handlers can ask for the first session before React has
  // committed activeSessionId. Share one create request per selected scope.
  const pendingSessionCreations = useRef(new Map<string, Promise<string | null>>());
  const sessionListRequestGenerations = useRef(new Map<string, number>());
  const transcriptHistoryRequestSessionId = useRef<string | null>(null);
  const historySeekRequestGeneration = useRef(0);
  const [transcriptHistoryLoading, setTranscriptHistoryLoading] = useState(false);

  const hydrateQueuedTurns = useCallback(
    async (sessionId: string): Promise<void> => {
      const response = await hostClient.request({
        type: 'session/queued-turn-list',
        sessionId,
      });
      if (!response.success) return;
      const data = response.data as {
        queueRevision?: unknown;
        queuedTurns?: unknown;
      } | undefined;
      if (
        data === undefined ||
        !Number.isSafeInteger(data.queueRevision) ||
        !Array.isArray(data.queuedTurns)
      )
        return;
      const queueRevision = data.queueRevision as number;
      dispatch({
        type: 'session/queued-turns-hydrate',
        sessionId,
        queueRevision,
        queuedTurns: data.queuedTurns as import('@piwin/contracts').QueuedTurnRecord[],
      });
    },
    [dispatch, hostClient],
  );

  const loadUserMessageIndex = useCallback(
    async (sessionId: string, epoch: number): Promise<void> => {
      const response = await hostClient.request({
        type: 'session/user-message-index',
        query: {
          sessionId,
          maximumTicks: SESSION_USER_MESSAGE_INDEX_DEFAULT_TICKS,
        },
      });
      if (!response.success) {
        // The rail can continue using resident user rows while an older Host
        // or a cold session does not expose the optional index capability.
        return;
      }
      const index = response.data as SessionUserMessageIndexData;
      dispatch({ type: 'session/user-message-index', sessionId, epoch, index });
    },
    [dispatch, hostClient],
  );

  const handleJumpToHistoryAnchor = useCallback(
    async (anchor: SessionUserMessageAnchor): Promise<void> => {
      const sessionId = state.activeSessionId;
      if (!sessionId) {
        return;
      }
      const requestGeneration = historySeekRequestGeneration.current + 1;
      historySeekRequestGeneration.current = requestGeneration;
      const epoch = state.userMessageIndexEpoch;
      const response = await hostClient.request({
        type: 'session/transcript-window',
        query: {
          sessionId,
          anchorMessageId: anchor.messageId,
          beforeItems: SESSION_TRANSCRIPT_WINDOW_DEFAULT_BEFORE_ITEMS,
          afterItems: SESSION_TRANSCRIPT_WINDOW_DEFAULT_AFTER_ITEMS,
          maximumBytes: SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
        },
      });
      if (historySeekRequestGeneration.current !== requestGeneration) {
        return;
      }
      if (!response.success) {
        dispatch({ type: 'error', message: response.error });
        return;
      }
      const data = response.data as SessionTranscriptWindowData;
      if (data.status === 'window') {
        dispatch({
          type: 'session/seek-messages',
          sessionId,
          epoch,
          messages: data.messages,
          window: data.window,
        });
      }
    },
    [dispatch, hostClient, state.activeSessionId, state.userMessageIndexEpoch],
  );

  const handleReturnToLiveTranscript = useCallback((): void => {
    historySeekRequestGeneration.current += 1;
    const sessionId = state.activeSessionId;
    if (sessionId) {
      dispatch({ type: 'session/return-to-live', sessionId });
    }
  }, [dispatch, state.activeSessionId]);

  const selectedModelRef = useCallback((): ModelRef | undefined => {
    if (!selectedModelKey) {
      return undefined;
    }
    const option = modelOptions.find(
      (item) => `${item.providerId}::${item.modelId}` === selectedModelKey,
    );
    if (!option) {
      return undefined;
    }
    return {
      protocol: option.protocol,
      providerId: option.providerId,
      modelId: option.modelId,
    };
  }, [modelOptions, selectedModelKey]);

  const selectedModelOption = useCallback(() => {
    return modelOptions.find((item) => `${item.providerId}::${item.modelId}` === selectedModelKey);
  }, [modelOptions, selectedModelKey]);

  const hydrateSessions = useCallback(
    async (
      projectPathOrScope?: string | { kind: 'general' } | { kind: 'project'; projectPath: string },
      options?: {
        includeArchived?: boolean;
        order?: SessionListOrder;
        /**
         * When true, an explicit project list also fills the active `sessions`
         * array. Needed after `project/set` in the same tick: the hydrate
         * closure still sees the previous activeScope, so isActiveProject
         * would otherwise only update the folder map and leave the open
         * project empty in the sidebar.
         */
        fillActiveList?: boolean;
      },
    ): Promise<SessionSummary[]> => {
      const includeArchived = options?.includeArchived ?? showArchivedSessions;
      const scope: SessionScope =
        typeof projectPathOrScope === 'object' && projectPathOrScope !== null
          ? projectPathOrScope
          : typeof projectPathOrScope === 'string' && projectPathOrScope.trim().length > 0
            ? { kind: 'project', projectPath: projectPathOrScope }
            : state.activeScope;
      const scopeKey = sessionScopeKey(scope);
      const requestGeneration = (sessionListRequestGenerations.current.get(scopeKey) ?? 0) + 1;
      sessionListRequestGenerations.current.set(scopeKey, requestGeneration);
      const listed = await hostClient.request(
        sessionListCommandForTransport({
          transport: hostClient.getTransport(),
          scope,
          includeArchived,
          order: options?.order ?? sessionListOrder,
          maxItems: DESKTOP_SESSION_LIST_MAX_ITEMS,
        }),
      );
      if (!listed.success) {
        if (sessionListRequestGenerations.current.get(scopeKey) === requestGeneration) {
          dispatch({ type: 'error', message: `Could not load sessions: ${listed.error}` });
        }
        return [];
      }
      const mapped = mapListedSessionItems(listed.data);
      const named = mapped.sessions.filter((session) => sessionHasListName(session));
      if (sessionListRequestGenerations.current.get(scopeKey) === requestGeneration) {
        dispatch({
          type: 'session/hydrate-scope',
          scope,
          sessions: named,
          totalCount: mapped.totalCount,
          truncated: mapped.truncated,
          ...(options?.fillActiveList === true ? { fillActiveList: true } : {}),
        });
      }
      const data = listed.data as SessionListData;
      if (Array.isArray(data.sessions) && typeof data.sessions[0]?.id === 'string') {
        return data.sessions.filter((session) =>
          named.some((item) => item.id === session.id),
        );
      }
      return named.map((item) => ({
        id: item.id,
        name: item.name,
        scope: item.scope ?? scope,
        workingDirectory: item.scope?.kind === 'project' ? item.scope.projectPath : '',
        projectPath: item.scope?.kind === 'project' ? item.scope.projectPath : '',
        updatedAt: item.updatedAt ?? '',
        messageCount: item.messageCount ?? 0,
      }));
    },
    [dispatch, hostClient, sessionListOrder, showArchivedSessions, state.activeScope],
  );

  const handleResumeSession = useCallback(
    async (
      sessionId: string,
      context?: { scope?: SessionScope },
    ): Promise<void> => {
      const effectiveActiveScope = context?.scope ?? state.activeScope;
      const targetScopeHint = context?.scope ?? resolveSessionScopeHint?.(sessionId);
      // Project ownership wins when a session is dual-listed (the bug that
      // painted the same row under both Projects and Conversations).
      const knownProjectPath =
        Object.entries(state.projectSessionsByPath).find(([, list]) =>
          list.some((session) => session.id === sessionId),
        )?.[0] ?? (targetScopeHint?.kind === 'project' ? targetScopeHint.projectPath : undefined);
      const knownGeneral =
        state.generalSessions.some((session) => session.id === sessionId) ||
        targetScopeHint?.kind === 'general';
      const existingListItem =
        knownProjectPath != null
          ? state.projectSessionsByPath[knownProjectPath]?.find(
              (session) => session.id === sessionId,
            )
          : (state.generalSessions.find((session) => session.id === sessionId) ??
            state.sessions.find((session) => session.id === sessionId));

      if (
        knownProjectPath &&
        (effectiveActiveScope.kind !== 'project' ||
          effectiveActiveScope.projectPath !== knownProjectPath)
      ) {
        // Switch into the owning project without going through handleOpenProject
        // (that helper also resumes, which would recurse).
        const openResponse = await hostClient.request({
          type: 'project/open',
          path: knownProjectPath,
        });
        if (!openResponse.success) {
          dispatch({ type: 'error', message: openResponse.error });
          return;
        }
        const openPayload = openResponse.data as {
          path?: string;
          trusted?: boolean;
          trust?: string;
        };
        let trusted = openPayload.trusted === true || openPayload.trust === 'trusted';
        const openedPath = openPayload.path ?? knownProjectPath;
        if (!trusted) {
          const trustResponse = await hostClient.request({
            type: 'project/trust',
            path: openedPath,
          });
          if (!trustResponse.success) {
            dispatch({ type: 'project/set', path: openedPath, trusted: false });
            dispatch({ type: 'error', message: trustResponse.error });
            return;
          }
          trusted = true;
        }
        dispatch({ type: 'project/set', path: openedPath, trusted });
        await hydrateSessions(openedPath, {
          fillActiveList: true,
        });
        void hydrateSessions({ kind: 'general' }, { includeArchived: showArchivedSessions });
      }
      if (knownGeneral && !knownProjectPath && effectiveActiveScope.kind === 'project') {
        dispatch({ type: 'project/clear' });
        await hydrateSessions(
          { kind: 'general' },
          {
            includeArchived: showArchivedSessions,
          },
        );
      }

      dispatch({ type: 'session/set', sessionId, awaitTranscript: true });
      const resumed = await hostClient.request({
        type: 'session/resume',
        sessionId,
      });
      if (!resumed.success) {
        dispatch({
          type: 'error',
          message: `${resumed.error} — start a New session to continue in this process.`,
        });
        // Clear the painted previous transcript and exit awaitingTranscript so
        // the UI does not stay stuck showing another session's rows.
        dispatch({
          type: 'session/load-messages',
          sessionId,
          messages: [],
          live: false,
        });
        return;
      }
      const data = resumed.data as {
        sessionId: string;
        live: boolean;
        messages?: SessionTranscriptMessage[];
        transcriptPage?: SessionTranscriptPageInfo;
        outline?: import('@piwin/contracts').SessionOutlineNode[];
        model?: ModelRef;
        thinkingLevel?: import('@piwin/contracts').ThinkingLevel;
        contextUsage?: import('@piwin/contracts').ContextUsageSnapshot;
        scope?: import('@piwin/contracts').SessionScope;
        projectPath?: string;
        name?: string;
      };
      // Host scope is authoritative. Prefer explicit scope; only treat a
      // non-empty projectPath as project when scope is missing (legacy).
      const resumedProjectPath =
        data.scope?.kind === 'project'
          ? data.scope.projectPath
          : data.scope?.kind === 'general'
            ? null
            : data.projectPath?.trim()
              ? data.projectPath
              : null;
      if (
        resumedProjectPath &&
        (effectiveActiveScope.kind !== 'project' ||
          effectiveActiveScope.projectPath !== resumedProjectPath) &&
        knownProjectPath !== resumedProjectPath
      ) {
        const openResponse = await hostClient.request({
          type: 'project/open',
          path: resumedProjectPath,
        });
        if (openResponse.success) {
          const openPayload = openResponse.data as {
            path?: string;
            trusted?: boolean;
            trust?: string;
          };
          let trusted = openPayload.trusted === true || openPayload.trust === 'trusted';
          const openedPath = openPayload.path ?? resumedProjectPath;
          if (!trusted) {
            const trustResponse = await hostClient.request({
              type: 'project/trust',
              path: openedPath,
            });
            trusted = trustResponse.success;
          }
          if (trusted) {
            dispatch({ type: 'project/set', path: openedPath, trusted: true });
            await hydrateSessions(openedPath, {
              fillActiveList: true,
              includeArchived: showArchivedSessions,
            });
            void hydrateSessions({ kind: 'general' }, { includeArchived: showArchivedSessions });
            dispatch({ type: 'session/set', sessionId, awaitTranscript: true });
          }
        }
      }
      if (
        data.scope?.kind === 'general' &&
        effectiveActiveScope.kind === 'project' &&
        !knownGeneral &&
        !resumedProjectPath
      ) {
        dispatch({ type: 'project/clear' });
        await hydrateSessions(
          { kind: 'general' },
          {
            includeArchived: showArchivedSessions,
          },
        );
        dispatch({ type: 'session/set', sessionId, awaitTranscript: true });
      }
      // Re-assert ownership with host scope so dual-listed rows collapse to
      // the correct sidebar section (project vs Conversations).
      if (data.scope || data.name) {
        dispatch({
          type: 'session/update',
          session: {
            id: sessionId,
            name: data.name ?? existingListItem?.name ?? '',
            ...(data.scope ? { scope: data.scope } : {}),
          },
        });
      }
      // Hydrate child summaries in the background so the activity dock and
      // inspector have data without blocking transcript load. The reducer
      // ignores children whose parent is not the active session, so a stale
      // response for a switched-away parent cannot leak into the UI.
      void (async () => {
        const childrenResponse = await hostClient.request({
          type: 'session/list-children',
          parentSessionId: sessionId,
        });
        if (!childrenResponse.success) {
          return;
        }
        const childrenData = childrenResponse.data as
          | {
              sessions?: SessionSummary[];
              invocations?: import('@piwin/contracts').SubagentInvocation[];
            }
          | undefined;
        dispatch({
          type: 'subagent/children-hydrate',
          parentSessionId: sessionId,
          children: childrenData?.sessions ?? [],
        });
        dispatch({
          type: 'subagent/invocations-hydrate',
          parentSessionId: sessionId,
          invocations: childrenData?.invocations ?? [],
        });
      })();
      if (data.model || data.thinkingLevel !== undefined) {
        onSessionComposerProfileRestored?.({
          ...(data.model ? { model: data.model } : {}),
          ...(data.thinkingLevel !== undefined ? { thinkingLevel: data.thinkingLevel } : {}),
        });
      }
      const messages = data.messages ?? [];
      if (messages.length === 0 && data.transcriptPage === undefined) {
        // Legacy Host compatibility only. Page-aware Hosts mark an empty tail
        // explicitly, so Desktop never falls back to a complete-array read.
        const listed = await hostClient.request({
          type: 'session/messages',
          sessionId,
        });
        if (listed.success) {
          const listedData = listed.data as { messages: SessionTranscriptMessage[] };
          const outlineInput: {
            transcriptMessages: SessionTranscriptMessage[];
            outline?: import('@piwin/contracts').SessionOutlineNode[] | null;
          } = { transcriptMessages: listedData.messages };
          if (data.outline !== undefined) {
            outlineInput.outline = data.outline;
          }
          const outline = resolveSessionOutline(outlineInput);
          dispatch({
            type: 'session/load-messages',
            sessionId,
            messages: listedData.messages,
            outline,
            contextUsage: data.contextUsage ?? null,
            live: data.live,
          });
          await hydrateQueuedTurns(sessionId);
          return;
        }
      }
      const outlineInput: {
        transcriptMessages: SessionTranscriptMessage[];
        outline?: import('@piwin/contracts').SessionOutlineNode[] | null;
      } = { transcriptMessages: messages };
      if (data.outline !== undefined) {
        outlineInput.outline = data.outline;
      }
      const outline = resolveSessionOutline(outlineInput);
      dispatch({
        type: 'session/load-messages',
        sessionId,
        messages,
        ...(data.transcriptPage ? { transcriptPage: data.transcriptPage } : {}),
        outline,
        contextUsage: data.contextUsage ?? null,
        live: data.live,
      });
      await hydrateQueuedTurns(sessionId);
    },
    [
      dispatch,
      dispatchNotification,
      hydrateQueuedTurns,
      hostClient,
      hydrateSessions,
      onSessionComposerProfileRestored,
      resolveSessionScopeHint,
      showArchivedSessions,
      state.activeScope,
      state.generalSessions,
      state.projectSessionsByPath,
      state.sessions,
    ],
  );

  const handleLoadOlderTranscript = useCallback(async (): Promise<void> => {
    const sessionId = state.activeSessionId;
    const transcriptWindow = state.transcriptWindow;
    const olderCursor = transcriptWindow?.olderCursor;
    if (
      !sessionId ||
      !transcriptWindow ||
      !olderCursor ||
      transcriptWindow.cacheLimitReached ||
      transcriptHistoryRequestSessionId.current !== null
    ) {
      return;
    }

    transcriptHistoryRequestSessionId.current = sessionId;
    setTranscriptHistoryLoading(true);
    try {
      const pageResult = await requestSessionTranscriptPage(
        (command) => hostClient.request(command),
        {
          sessionId,
          limit: SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
          maximumBytes: SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
          beforeCursor: olderCursor,
        },
      );
      if (!pageResult.success) {
        dispatch({ type: 'error', message: pageResult.error });
        return;
      }
      if (!pageResult.restartedAtTail) {
        dispatch({
          type: 'session/prepend-messages',
          sessionId,
          messages: pageResult.data.messages,
          transcriptPage: pageResult.data.page,
        });
        return;
      }

      dispatch({
        type: 'session/load-messages',
        sessionId,
        messages: pageResult.data.messages,
        transcriptPage: pageResult.data.page,
        outline: state.outline,
        preserveActiveTail: true,
      });
      // dispatchNotification(pushInfo('Transcript changed; refreshed the newest history page.'));
    } finally {
      if (transcriptHistoryRequestSessionId.current === sessionId) {
        transcriptHistoryRequestSessionId.current = null;
        setTranscriptHistoryLoading(false);
      }
    }
  }, [
    dispatch,
    dispatchNotification,
    hostClient,
    state.activeSessionId,
    state.outline,
    state.transcriptWindow,
  ]);

  const ensureSession = useCallback(
    async (options?: {
      projectPath?: string;
      alreadyTrusted?: boolean;
      scope?: { kind: 'general' } | { kind: 'project'; projectPath: string };
      sessionName?: string;
    }): Promise<string | null> => {
      const explicitScope = options?.scope;
      const useGeneral =
        explicitScope?.kind === 'general' ||
        (!explicitScope &&
          !options?.projectPath &&
          (state.activeScope.kind === 'general' || !state.projectPath));

      const requestedProjectPath =
        options?.projectPath ??
        (explicitScope?.kind === 'project' ? explicitScope.projectPath : undefined) ??
        state.projectPath;
      const scopeKey = useGeneral ? 'general' : `project:${requestedProjectPath?.trim() ?? ''}`;
      const existingCreation = pendingSessionCreations.current.get(scopeKey);
      if (existingCreation) {
        return existingCreation;
      }

      const createSession = async (): Promise<string | null> => {
        let createInput: {
          scope?: { kind: 'general' } | { kind: 'project'; projectPath: string };
          projectPath?: string;
          model?: ModelRef;
          thinkingLevel?: import('@piwin/contracts').ThinkingLevel;
          sessionName?: string;
        };

        if (useGeneral) {
          createInput = {
            scope: { kind: 'general' },
          };
        } else {
          const projectPath = requestedProjectPath;
          if (!projectPath) {
            dispatch({ type: 'error', message: 'Open a project first' });
            return null;
          }
          const trusted = options?.alreadyTrusted === true || state.projectTrusted;
          if (!trusted) {
            dispatch({ type: 'project/trust-dialog', open: true });
            return null;
          }
          createInput = {
            scope: { kind: 'project', projectPath },
            projectPath,
          };
        }
        if (options?.sessionName) {
          createInput.sessionName = options.sessionName;
        }
        const model = selectedModelRef();
        if (model) {
          createInput.model = model;
        }
        if (thinkingLevel) {
          createInput.thinkingLevel = thinkingLevel;
        }
        const created = await hostClient.request({
          type: 'session/create',
          input: createInput,
        });
        if (!created.success) {
          dispatch({ type: 'error', message: created.error });
          return null;
        }
        const sessionId = (created.data as { sessionId: string }).sessionId;
        const explicitName = options?.sessionName?.trim();
        if (explicitName) {
          // Named at create → listable immediately.
          dispatch({
            type: 'session/add',
            sessionId,
            name: explicitName,
          });
        } else {
          // Unnamed until first user message assigns a text title. Activate
          // without inserting a placeholder row into the sidebar.
          dispatch({ type: 'session/set', sessionId });
        }
        return sessionId;
      };

      const creation = createSession().finally(() => {
        pendingSessionCreations.current.delete(scopeKey);
      });
      pendingSessionCreations.current.set(scopeKey, creation);
      return creation;
    },
    [
      dispatch,
      hostClient,
      selectedModelRef,
      thinkingLevel,
      state.projectPath,
      state.projectTrusted,
      state.activeScope,
    ],
  );

  const handleOpenProject = useCallback(
    async (
      path: string,
      options?: { autoTrust?: boolean; resumeSessionId?: string; switchSession?: boolean },
    ): Promise<void> => {
      const resumeSessionId = options?.resumeSessionId;
      const response = await hostClient.request({
        type: 'project/open',
        path,
      });
      if (!response.success) {
        dispatch({ type: 'error', message: response.error });
        return;
      }
      const payload = response.data as {
        path?: string;
        trusted?: boolean;
        trust?: string;
      };
      let trusted = payload.trusted === true || payload.trust === 'trusted';
      const openedPath = payload.path ?? path;
      // Explicitly opening a folder is consent. Startup restoration passes
      // autoTrust: false so reopening history never expands trust silently.
      if (!trusted && options?.autoTrust !== false) {
        const trustResponse = await hostClient.request({
          type: 'project/trust',
          path: openedPath,
        });
        if (!trustResponse.success) {
          dispatch({ type: 'project/set', path: openedPath, trusted: false });
          setProjectPickerOpen(false);
          dispatch({ type: 'error', message: trustResponse.error });
          return;
        }
        trusted = true;
      }
      dispatch({ type: 'project/set', path: openedPath, trusted });
      setProjectPickerOpen(false);
      // Hydrate sessions for opened project. Do not force-switch session when simply opening/expanding a folder.
      const sessions = await hydrateSessions(openedPath, {
        fillActiveList: true,
      });
      // Also hydrate general sessions in the background so the Conversations
      // sidebar section stays populated while a project is active.
      void hydrateSessions({ kind: 'general' }, { includeArchived: showArchivedSessions });
      if (resumeSessionId) {
        await handleResumeSession(resumeSessionId, {
          scope: { kind: 'project', projectPath: openedPath },
        });
      } else if (options?.switchSession) {
        if (sessions[0]) {
          await handleResumeSession(sessions[0].id, {
            scope: { kind: 'project', projectPath: openedPath },
          });
        } else if (trusted) {
          await ensureSession({ projectPath: openedPath, alreadyTrusted: true });
        }
      }
    },
    [
      dispatch,
      ensureSession,
      handleResumeSession,
      hostClient,
      hydrateSessions,
      setProjectPickerOpen,
      showArchivedSessions,
    ],
  );

  const handleOpenWorkspaceClick = useCallback(async (): Promise<void> => {
    const defaultPath = state.projectPath?.trim() || projectInput.trim() || undefined;
    const selected = await pickProjectDirectory({
      ...(defaultPath ? { defaultPath } : {}),
      title: 'Open workspace',
    });
    if (selected) {
      await handleOpenProject(selected);
      return;
    }
    if (!isDesktopShellRuntime()) {
      setProjectPickerOpen(true);
    }
  }, [handleOpenProject, projectInput, setProjectPickerOpen, state.projectPath]);

  const handleBrowseProject = useCallback(async (): Promise<void> => {
    const defaultPath = state.projectPath?.trim() || projectInput.trim() || undefined;
    const selected = await pickProjectDirectory({
      ...(defaultPath ? { defaultPath } : {}),
      title: 'Open workspace',
    });
    if (selected) {
      await handleOpenProject(selected);
      return;
    }
    if (!isDesktopShellRuntime()) {
      setProjectPickerOpen(true);
    }
  }, [handleOpenProject, projectInput, setProjectPickerOpen, state.projectPath]);

  const handleTrustProject = useCallback(
    async (trust: boolean): Promise<void> => {
      if (!state.projectPath) {
        dispatch({ type: 'project/trust-dialog', open: false });
        return;
      }
      if (!trust) {
        dispatch({ type: 'project/trust-dialog', open: false });
        setHostLogEntries((current) =>
          appendHostLogEntry(current, {
            level: 'info',
            message: 'Project left untrusted — tools and shell stay blocked until you trust it.',
            at: new Date().toISOString(),
          }),
        );
        return;
      }
      const projectPath = state.projectPath;
      const response = await hostClient.request({
        type: 'project/trust',
        path: projectPath,
      });
      if (!response.success) {
        dispatch({ type: 'error', message: response.error });
        return;
      }
      dispatch({ type: 'project/trusted' });
      // After trust: resume existing history, or create a blank session so the
      // user can type without an extra "New session" click.
      const sessions = await hydrateSessions(projectPath);
      if (sessions[0]) {
        await handleResumeSession(sessions[0].id);
      } else {
        await ensureSession({ projectPath, alreadyTrusted: true });
      }
    },
    [
      dispatch,
      ensureSession,
      handleResumeSession,
      hostClient,
      hydrateSessions,
      setHostLogEntries,
      state.projectPath,
    ],
  );

  // New session button: enter draft mode without creating a host session.
  // The session is created lazily on first send via resolveSessionIdForComposer
  // → ensureSession. This avoids cluttering the sidebar with unnamed sessions.
  // The scope parameter is handled by callers (e.g. onNewGeneralSession does
  // project/clear before calling this); here we only clear the active session.
  const handleNewSession = useCallback(
    async (_options?: {
      scope?: { kind: 'general' } | { kind: 'project'; projectPath: string };
    }): Promise<void> => {
      dispatch({ type: 'session/clear-active' });
    },
    [dispatch],
  );

  const handleExportSession = useCallback(
    async (options?: { format?: 'md' | 'html'; redactTools?: boolean }): Promise<void> => {
      const sessionId = state.activeSessionId;
      if (!sessionId) {
        dispatch({ type: 'error', message: 'Select a session before exporting.' });
        return;
      }
      const format = options?.format === 'html' ? 'html' : 'md';
      const redactTools = options?.redactTools === true;
      const defaultName = `piwin-export-${sessionId.slice(0, 8)}.${
        format === 'html' ? 'html' : 'md'
      }`;

      let outputPath: string | undefined;
      const selectedPath = await chooseSessionExportPath({
        title: 'Export session',
        defaultName,
        format,
      });
      if (selectedPath === null) {
        return;
      }
      if (selectedPath) {
        outputPath = selectedPath;
      }

      const command: {
        type: 'session/export';
        sessionId: string;
        format: 'md' | 'html';
        redactTools: boolean;
        outputPath?: string;
      } = {
        type: 'session/export',
        sessionId,
        format,
        redactTools,
      };
      if (outputPath) {
        command.outputPath = outputPath;
      }
      const response = await hostClient.request(command);
      if (!response.success) {
        dispatch({ type: 'error', message: response.error });
        return;
      }
      const data = response.data as { path?: string; byteLength?: number; format?: string };
      const pathLabel = data.path ?? '(unknown path)';
      const sizeLabel = typeof data.byteLength === 'number' ? ` (${data.byteLength} bytes)` : '';
      setHostLogEntries((current) =>
        appendHostLogEntry(current, {
          level: 'info',
          message: `Exported session to ${pathLabel}${sizeLabel}`,
          at: new Date().toISOString(),
        }),
      );
    },
    [dispatch, hostClient, setHostLogEntries, state.activeSessionId],
  );

  const handleTogglePin = useCallback(
    async (sessionId: string, currentlyPinned: boolean): Promise<void> => {
      const response = await hostClient.request({
        type: currentlyPinned ? 'session/unpin' : 'session/pin',
        sessionId,
      });
      if (!response.success) {
        dispatch({ type: 'error', message: response.error });
        return;
      }
      const data = response.data as {
        session?: SessionSummary;
        isPinned?: boolean;
        pinnedAt?: string;
      };
      const session = data.session;
      const existing = state.sessions.find((item) => item.id === sessionId);
      const nextSession: SessionListItemUi = {
        id: sessionId,
        name: session?.name ?? existing?.name ?? sessionId.slice(0, 8),
      };
      if (session?.lastPreview) nextSession.lastPreview = session.lastPreview;
      else if (existing?.lastPreview) nextSession.lastPreview = existing.lastPreview;
      if (typeof session?.messageCount === 'number') {
        nextSession.messageCount = session.messageCount;
      } else if (typeof existing?.messageCount === 'number') {
        nextSession.messageCount = existing.messageCount;
      }
      if (session?.updatedAt) nextSession.updatedAt = session.updatedAt;
      else if (existing?.updatedAt) nextSession.updatedAt = existing.updatedAt;
      if (data.isPinned === true || session?.isPinned === true) {
        nextSession.isPinned = true;
        const pinnedAt = session?.pinnedAt ?? data.pinnedAt;
        if (pinnedAt) nextSession.pinnedAt = pinnedAt;
      } else {
        nextSession.isPinned = false;
      }
      dispatch({ type: 'session/update', session: nextSession });
    },
    [dispatch, hostClient, state],
  );

  const handleRenameSession = useCallback(
    async (sessionId: string, name: string): Promise<void> => {
      const response = await hostClient.request({
        type: 'session/rename',
        sessionId,
        name,
      });
      if (!response.success) {
        dispatch({ type: 'error', message: response.error });
        return;
      }
      const data = response.data as { session?: SessionSummary; name?: string };
      if (data.session) {
        dispatch({ type: 'session/update', session: summaryToListItem(data.session, sessionId) });
      } else {
        dispatch({
          type: 'session/update',
          session: { id: sessionId, name: data.name ?? name.trim() },
        });
      }
      dispatchNotification(pushSuccess(`Renamed to “${data.name ?? name.trim()}”`));
    },
    [dispatch, dispatchNotification, hostClient],
  );

  const handleArchiveSession = useCallback(
    async (sessionId: string): Promise<void> => {
      const sessionScope =
        resolveSessionScopeHint?.(sessionId) ?? resolveKnownSessionScope(state, sessionId);
      const response = await hostClient.request({ type: 'session/archive', sessionId });
      if (!response.success) {
        dispatch({ type: 'error', message: response.error });
        return;
      }
      dispatchNotification(pushSuccess('Agent archived'));
      if (showArchivedSessions) {
        await hydrateSessions(sessionScope, {
          includeArchived: true,
        });
      } else {
        const wasActive = state.activeSessionId === sessionId;
        if (wasActive) {
          // Keep transcript visible; remove only from the active list.
          dispatch({ type: 'session/hide-from-list', sessionId });
        } else {
          dispatch({ type: 'session/remove', sessionId });
        }
        await hydrateSessions(sessionScope, { includeArchived: false });
      }
    },
    [
      dispatch,
      dispatchNotification,
      hostClient,
      hydrateSessions,
      resolveSessionScopeHint,
      showArchivedSessions,
      state,
    ],
  );

  const handleUnarchiveSession = useCallback(
    async (sessionId: string): Promise<void> => {
      const sessionScope =
        resolveSessionScopeHint?.(sessionId) ?? resolveKnownSessionScope(state, sessionId);
      const response = await hostClient.request({ type: 'session/unarchive', sessionId });
      if (!response.success) {
        dispatch({ type: 'error', message: response.error });
        return;
      }
      if (state.activeSessionId === sessionId) {
        dispatch({ type: 'session/mark-archived-active', archived: false });
      }
      dispatchNotification(pushSuccess('Agent restored'));
      await hydrateSessions(sessionScope, {
        includeArchived: showArchivedSessions,
      });
    },
    [
      dispatch,
      dispatchNotification,
      hostClient,
      hydrateSessions,
      resolveSessionScopeHint,
      showArchivedSessions,
      state,
    ],
  );

  const confirmDeleteSession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      const response = await hostClient.request({ type: 'session/delete', sessionId });
      if (!response.success) {
        dispatch({ type: 'error', message: response.error });
        return false;
      }
      forgetTranscriptScrollPosition(sessionId);
      const wasActive = state.activeSessionId === sessionId;
      dispatch({ type: 'session/remove', sessionId });
      if (wasActive) {
        dispatch({ type: 'session/clear-active' });
      }
      dispatchNotification(pushSuccess('Agent deleted permanently'));
      return true;
    },
    [dispatch, dispatchNotification, hostClient, state],
  );

  /** Request path kept for menu handlers that still need an entry point. */
  const handleDeleteSession = useCallback(
    async (sessionId: string): Promise<void> => {
      await confirmDeleteSession(sessionId);
    },
    [confirmDeleteSession],
  );

  const handleDuplicateSession = useCallback(
    async (sessionId: string): Promise<void> => {
      if (
        transcriptOwnerBlocksDangerousAction({
          transcriptOwnerSessionId: state.transcriptOwnerSessionId,
          activeSessionId: state.activeSessionId,
        })
      ) {
        dispatchNotification(
          pushError('Transcript is still loading for this session — try again in a moment.'),
        );
        return;
      }
      const response = await hostClient.request({
        type: 'session/duplicate',
        sessionId,
        messageProjection: 'none',
      });
      if (!response.success) {
        dispatch({ type: 'error', message: response.error });
        return;
      }
      const data = response.data as {
        sessionId: string;
        session?: SessionSummary;
      };
      const listItem = data.session
        ? summaryToListItem(data.session, data.sessionId)
        : { id: data.sessionId, name: 'Copy of session' };
      dispatch({ type: 'session/update', session: listItem });
      dispatchNotification(pushSuccess(`Duplicated as “${listItem.name}”`));
      await handleResumeSession(data.sessionId);
    },
    [
      dispatch,
      dispatchNotification,
      handleResumeSession,
      hostClient,
      state.activeSessionId,
      state.transcriptOwnerSessionId,
    ],
  );

  const handleContinueSessionInProject = useCallback(
    async (sessionId: string, projectPath: string): Promise<boolean> => {
      const response = await hostClient.request({
        type: 'session/duplicate',
        sessionId,
        targetScope: { kind: 'project', projectPath },
        messageProjection: 'none',
      });
      if (!response.success) {
        dispatch({ type: 'error', message: response.error });
        return false;
      }
      const data = response.data as {
        sessionId: string;
        session?: SessionSummary;
      };
      const listItem = data.session
        ? summaryToListItem(data.session, data.sessionId)
        : { id: data.sessionId, name: 'Continued session' };
      dispatch({ type: 'session/update', session: listItem });
      dispatchNotification(pushSuccess(`Continued “${listItem.name}” in project`));
      await handleResumeSession(data.sessionId);
      return true;
    },
    [dispatch, dispatchNotification, handleResumeSession, hostClient],
  );

  const handleForkSession = useCallback(
    async (sessionId: string, messageId: string): Promise<void> => {
      if (
        transcriptOwnerBlocksDangerousAction({
          transcriptOwnerSessionId: state.transcriptOwnerSessionId,
          activeSessionId: state.activeSessionId,
        })
      ) {
        dispatchNotification(
          pushError('Transcript is still loading for this session — try again in a moment.'),
        );
        return;
      }
      const response = await hostClient.request({
        type: 'session/fork',
        sessionId,
        messageId,
        workspaceStrategy: 'shared',
        messageProjection: 'none',
      });
      if (!response.success) {
        dispatch({ type: 'error', message: response.error });
        return;
      }
      const data = response.data as {
        sessionId: string;
        session?: SessionSummary;
      };
      const listItem = data.session
        ? summaryToListItem(data.session, data.sessionId)
        : { id: data.sessionId, name: 'Forked session' };
      dispatch({ type: 'session/update', session: listItem });
      dispatchNotification(pushSuccess(`Forked as "${listItem.name}"`));
      await handleResumeSession(data.sessionId);
    },
    [
      dispatch,
      dispatchNotification,
      handleResumeSession,
      hostClient,
      state.activeSessionId,
      state.transcriptOwnerSessionId,
    ],
  );

  const handleSessionMenuAction = useCallback(
    async (sessionId: string, action: SessionRowMenuAction): Promise<void> => {
      const session = state.sessions.find((item) => item.id === sessionId);
      switch (action) {
        case 'pin':
          await handleTogglePin(sessionId, false);
          break;
        case 'unpin':
          await handleTogglePin(sessionId, true);
          break;
        case 'rename':
          setRenameDraft({
            sessionId,
            name: session?.name ?? '',
          });
          break;
        case 'copy-id':
          try {
            await navigator.clipboard.writeText(sessionId);
            dispatchNotification(pushSuccess('Session ID copied to clipboard'));
          } catch {
            dispatch({ type: 'error', message: 'Could not copy session ID' });
          }
          break;
        case 'duplicate':
          await handleDuplicateSession(sessionId);
          break;
        case 'continue-in-project':
          // App owns project selection; this action only opens that picker.
          break;
        case 'archive':
          await handleArchiveSession(sessionId);
          break;
        case 'unarchive':
          await handleUnarchiveSession(sessionId);
          break;
        case 'delete':
          // App owns ConfirmDialog for permanent delete — menu only signals intent.
          break;
        case 'export':
          if (state.activeSessionId !== sessionId) {
            await handleResumeSession(sessionId);
          }
          await handleExportSession({ format: 'md', redactTools: false });
          break;
        default:
          break;
      }
    },
    [
      handleArchiveSession,
      confirmDeleteSession,
      handleDuplicateSession,
      handleExportSession,
      handleResumeSession,
      handleTogglePin,
      handleUnarchiveSession,
      setRenameDraft,
      state.activeSessionId,
      state.sessions,
    ],
  );

  /** UI pages and optimistic sends both retain the Host-persisted message id. */
  const resolveHostUserMessageId = useCallback(
    (uiMessageId: string): string | null => {
      const visibleMessages = state.historyView?.messages ?? state.messages;
      const uiMessage = visibleMessages.find((message) => message.id === uiMessageId);
      if (!uiMessage || uiMessage.role !== 'user') {
        const errorMessage = `Cannot restore: message not found in chat (${uiMessageId})`;
        dispatch({ type: 'error', message: errorMessage });
        dispatchNotification(pushError(errorMessage));
        return null;
      }
      return uiMessage.id;
    },
    [dispatch, dispatchNotification, state.historyView, state.messages],
  );

  const handleEditAndResend = useCallback(
    async (messageId: string, nextText: string): Promise<void> => {
      if (!state.activeSessionId) {
        dispatchNotification(pushError('No active session to restore.'));
        return;
      }
      if (state.streaming) {
        dispatchNotification(
          pushInfo('Wait for the current run to finish (or stop it) before restoring.'),
        );
        return;
      }
      const text = nextText.trim();
      if (!text) {
        return;
      }
      const isGeneral = state.activeScope.kind === 'general' || !state.projectPath;
      if (!isGeneral && !state.projectTrusted) {
        dispatch({ type: 'project/trust-dialog', open: true });
        return;
      }

      const resolvedMessageId = resolveHostUserMessageId(messageId);
      if (!resolvedMessageId) {
        return;
      }

      const truncate = await hostClient.request({
        type: 'session/truncate-from',
        sessionId: state.activeSessionId,
        messageId: resolvedMessageId,
        messageProjection: 'tail',
      });
      if (!truncate.success) {
        dispatch({ type: 'error', message: truncate.error });
        dispatchNotification(pushError(truncate.error));
        return;
      }
      const truncData = truncate.data as {
        messages?: SessionTranscriptMessage[];
        transcriptPage?: SessionTranscriptPageInfo;
      };
      dispatch({
        type: 'session/truncate',
        sessionId: state.activeSessionId,
        messages: truncData.messages ?? [],
        ...(truncData.transcriptPage ? { transcriptPage: truncData.transcriptPage } : {}),
      });
      setEditingMessageId(null);
      // Keep the same client id for the resend bubble so a later Revert can
      // still match the host transcript without a resume. Host injects mode.
      const resendClientMessageId = crypto.randomUUID();
      dispatch({ type: 'user/send', text, clientMessageId: resendClientMessageId });
      const editInput: {
        text: string;
        model?: import('@piwin/contracts').ModelRef;
        thinkingLevel?: import('@piwin/contracts').ThinkingLevel;
        agentMode?: import('@piwin/contracts').AgentModeId;
        orchestrationSchemeId?: string;
        delegationMode?: 'auto' | 'disabled';
        clientMessageId?: string;
      } = {
        text,
        agentMode: agentMode,
        clientMessageId: resendClientMessageId,
      };
      if (orchestrationSchemeId && orchestrationSchemeId !== 'off') {
        editInput.orchestrationSchemeId = orchestrationSchemeId;
      }
      if (delegationDisabled) {
        editInput.delegationMode = 'disabled';
      }
      const editModel = selectedModelRef();
      if (editModel) {
        editInput.model = editModel;
      }
      const option = selectedModelOption();
      if (thinkingLevel && option && canUseThinkingLevel(option, thinkingLevel, true)) {
        editInput.thinkingLevel = thinkingLevel;
      }
      const response = await requestPromptWithForeground({
        request: (command) => hostClient.request(command),
        sessionId: state.activeSessionId,
        input: editInput,
        ...(confirmForegroundReplace ? { confirmReplace: confirmForegroundReplace } : {}),
        ...(typeof hostClient.supportsForegroundAdmission === 'function'
          ? { remoteForegroundAdmission: hostClient.supportsForegroundAdmission() }
          : {}),
      });
      if (!response.success) {
        dispatch({ type: 'user/send-rollback', clientMessageId: resendClientMessageId });
        const problem = readForegroundProblem(response);
        if (problem) {
          dispatch({ type: 'error', message: foregroundMismatchNotice(problem, locale) });
        } else {
          dispatch({ type: 'error', message: response.error });
          dispatchNotification(pushError(response.error));
        }
      } else {
        const accepted = response.data as { runId?: string; acceptedAt?: string };
        if (typeof accepted.runId === 'string') {
          dispatch({
            type: 'run/accepted',
            runId: accepted.runId,
            ...(accepted.acceptedAt ? { acceptedAt: accepted.acceptedAt } : {}),
          });
        }
      }
    },
    [
      agentMode,
      confirmForegroundReplace,
      dispatch,
      dispatchNotification,
      hostClient,
      locale,
      orchestrationSchemeId,
      delegationDisabled,
      resolveHostUserMessageId,
      selectedModelRef,
      setEditingMessageId,
      state.activeScope.kind,
      state.activeSessionId,
      state.projectPath,
      state.projectTrusted,
      state.streaming,
      thinkingLevel,
      selectedModelOption,
    ],
  );

  const handleRetryFromMessage = useCallback(
    async (messageId: string): Promise<void> => {
      if (!state.activeSessionId) {
        dispatchNotification(pushError('No active session to restore.'));
        return;
      }
      if (state.streaming) {
        dispatchNotification(
          pushInfo('Wait for the current run to finish (or stop it) before restoring.'),
        );
        return;
      }
      if (
        transcriptOwnerBlocksDangerousAction({
          transcriptOwnerSessionId: state.transcriptOwnerSessionId,
          activeSessionId: state.activeSessionId,
        })
      ) {
        dispatchNotification(
          pushError('Transcript is still loading for this session — try again in a moment.'),
        );
        return;
      }
      const visibleMessages = state.historyView?.messages ?? state.messages;
      const message = visibleMessages.find((item) => item.id === messageId);
      if (!message || message.role !== 'user') {
        dispatchNotification(pushError('Can only restore from a user message.'));
        return;
      }
      const text = message.text.trim();
      if (!text && message.attachments.length === 0) {
        dispatchNotification(pushError('Nothing to restore from this message.'));
        return;
      }
      const isGeneral = state.activeScope.kind === 'general' || !state.projectPath;
      if (!isGeneral && !state.projectTrusted) {
        dispatch({ type: 'project/trust-dialog', open: true });
        return;
      }

      // Cursor-style Restore chat: truncate the transcript at this user turn,
      // put the text back into the composer, and wait for the user to resend.
      // Map UI bubble id → host transcript id first (optimistic id mismatch).
      const resolvedMessageId = resolveHostUserMessageId(messageId);
      if (!resolvedMessageId) {
        return;
      }

      const truncate = await hostClient.request({
        type: 'session/truncate-from',
        sessionId: state.activeSessionId,
        messageId: resolvedMessageId,
        messageProjection: 'tail',
      });
      if (!truncate.success) {
        dispatch({ type: 'error', message: truncate.error });
        dispatchNotification(pushError(truncate.error));
        return;
      }
      const truncData = truncate.data as {
        messages?: SessionTranscriptMessage[];
        transcriptPage?: SessionTranscriptPageInfo;
      };
      dispatch({
        type: 'session/truncate',
        sessionId: state.activeSessionId,
        messages: truncData.messages ?? [],
        ...(truncData.transcriptPage ? { transcriptPage: truncData.transcriptPage } : {}),
      });
      setComposer(text);
      dispatchNotification(
        pushInfo('Conversation restored to this checkpoint. Edit and send when ready.'),
      );
    },
    [
      dispatch,
      dispatchNotification,
      hostClient,
      resolveHostUserMessageId,
      setComposer,
      state.activeScope.kind,
      state.activeSessionId,
      state.historyView,
      state.messages,
      state.projectPath,
      state.projectTrusted,
      state.streaming,
      state.transcriptOwnerSessionId,
    ],
  );

  const handleAbort = useCallback(async (): Promise<void> => {
    if (!state.activeSessionId || state.runPhase === 'aborting') {
      return;
    }
    const hasActiveRun = state.activeRunId !== null;
    if (hasActiveRun || state.streaming) {
      dispatch({ type: 'run/aborting' });
    }
    const response = await hostClient.request({
      type: 'session/abort',
      sessionId: state.activeSessionId,
      ...(state.activeRunId ? { runId: state.activeRunId } : {}),
    });
    if (!response.success) {
      dispatch({ type: 'error', message: response.error });
      return;
    }
    const data = response.data as { cancelled?: boolean; reason?: string } | undefined;
    if (data?.cancelled === true) {
      dispatchNotification(
        pushInfo(
          'Run stopped — in-flight tools were cancelled. The model should re-run them if needed.',
        ),
      );
    } else if (!hasActiveRun && state.runTerminal.kind === 'paused') {
      dispatch({ type: 'run/terminal-dismiss' });
    }
  }, [
    dispatch,
    dispatchNotification,
    hostClient,
    state.activeRunId,
    state.activeSessionId,
    state.runPhase,
    state.runTerminal.kind,
    state.streaming,
  ]);

  const handlePause = useCallback(async (): Promise<void> => {
    if (!state.activeSessionId || state.runPhase === 'aborting') {
      return;
    }
    dispatch({ type: 'run/aborting' });
    const response = await hostClient.request({
      type: 'session/pause',
      sessionId: state.activeSessionId,
      ...(state.activeRunId ? { runId: state.activeRunId } : {}),
    });
    if (!response.success) {
      dispatch({ type: 'error', message: response.error });
      return;
    }
    const data = response.data as { state?: string } | undefined;
    if (data?.state === 'pausing') {
      dispatchNotification(pushInfo('Run is pausing and saving a resumable checkpoint…'));
    }
  }, [
    dispatch,
    dispatchNotification,
    hostClient,
    state.activeRunId,
    state.activeSessionId,
    state.runPhase,
  ]);

  const handleResumeRun = useCallback(async (): Promise<void> => {
    if (!state.activeSessionId || state.runTerminal.kind !== 'paused') {
      return;
    }
    const response = await hostClient.request({
      type: 'session/resume-run',
      sessionId: state.activeSessionId,
      ...(state.runTerminal.checkpointId ? { checkpointId: state.runTerminal.checkpointId } : {}),
    });
    if (!response.success) {
      dispatch({ type: 'error', message: response.error });
      return;
    }
    const data = response.data as { runId?: string; acceptedAt?: string } | undefined;
    if (typeof data?.runId === 'string') {
      dispatch({
        type: 'run/accepted',
        runId: data.runId,
        ...(data.acceptedAt ? { acceptedAt: data.acceptedAt } : {}),
      });
    }
  }, [dispatch, hostClient, state.activeSessionId, state.runTerminal]);

  const handleCompact = useCallback(
    async (customInstructions?: string): Promise<void> => {
      if (!state.activeSessionId || state.compacting || state.streaming) {
        return;
      }
      const payload: {
        type: 'session/compact';
        sessionId: string;
        customInstructions?: string;
      } = {
        type: 'session/compact',
        sessionId: state.activeSessionId,
      };
      if (customInstructions && customInstructions.trim().length > 0) {
        payload.customInstructions = customInstructions.trim();
      }
      const response = await hostClient.request(payload);
      if (!response.success) {
        dispatch({ type: 'error', message: response.error });
      }
    },
    [dispatch, hostClient, state.activeSessionId, state.compacting, state.streaming],
  );

  const handleCompactAbort = useCallback(async (): Promise<void> => {
    if (!state.activeSessionId) {
      return;
    }
    const response = await hostClient.request({
      type: 'session/compact-abort',
      sessionId: state.activeSessionId,
    });
    if (!response.success) {
      dispatch({ type: 'error', message: response.error });
    }
  }, [dispatch, hostClient, state.activeSessionId]);

  const handlePermission = useCallback(
    async (
      decision: PermissionDecision,
      rememberScope: PermissionRememberScope = 'once',
    ): Promise<void> => {
      const prompt = state.permissionPrompt;
      if (!prompt) {
        return;
      }
      const payload: {
        type: 'permission/resolve';
        requestId: string;
        decision: PermissionDecision;
        rememberScope?: PermissionRememberScope;
      } = {
        type: 'permission/resolve',
        requestId: prompt.requestId,
        decision,
      };
      if (decision === 'allow') {
        payload.rememberScope = rememberScope;
      }
      const response = await hostClient.request(payload);
      dispatch({ type: 'permission/clear', requestId: prompt.requestId });
      if (!response.success) {
        dispatch({ type: 'error', message: response.error });
      }
    },
    [dispatch, hostClient, state.permissionPrompt],
  );

  return {
    hydrateSessions,
    transcriptHistoryLoading,
    loadUserMessageIndex,
    handleJumpToHistoryAnchor,
    handleReturnToLiveTranscript,
    handleOpenWorkspaceClick,
    handleBrowseProject,
    handleOpenProject,
    handleTrustProject,
    ensureSession,
    handleNewSession,
    handleResumeSession,
    handleLoadOlderTranscript,
    handleExportSession,
    handleTogglePin,
    handleRenameSession,
    handleArchiveSession,
    handleUnarchiveSession,
    handleDeleteSession,
    confirmDeleteSession,
    handleDuplicateSession,
    handleContinueSessionInProject,
    handleForkSession,
    handleSessionMenuAction,
    handleEditAndResend,
    handleRetryFromMessage,
    handleAbort,
    handlePause,
    handleResumeRun,
    handleCompact,
    handleCompactAbort,
    handlePermission,
  };
}
