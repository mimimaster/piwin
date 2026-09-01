/**
 * Project open/trust + session lifecycle + chat ops (edit/retry/abort/compact).
 */
import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import type {
  ModelRef,
  SessionListOrder,
  SessionScope,
  SessionSummary,
} from '@piwin/contracts';
import { toModelRef } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import type { ChatUiAction, ChatUiState, SessionListItemUi } from '../chat-reducer';
import type { NotificationAction } from '../notification-queue';
import { pushError, pushSuccess } from '../notification-queue';
import { appendHostLogEntry, type HostLogEntry } from '../HostLogPanel';
import type { SessionRowMenuAction } from '../session-row-menu';
import { pickOrPromptWorkspaceFolder } from '../workspace-open';
import { summaryToListItem } from './session-list-item';
import { chooseSessionExportPath } from '../session-export-dialog';
import { isSessionBodyOffloaded } from '../session-storage-ui';
import { forgetTranscriptScrollPosition } from '../transcript-scroll-memory';
import { transcriptOwnerBlocksDangerousAction } from '../transcript-owner-guard';
import { findSessionForLookup } from '../session-list-lookup';
import {
  activateProjectOnHost,
  sessionCreateInputForTransport,
} from '../remote-session-hydrate';
import { useDesktopLocale } from '../desktop-locale-context';
import { findAdjacentSessionId } from '../session-navigation';
import { createGestureIdempotencyKey } from '../gesture-idempotency.js';
import { logSessionChain, sessionChainErrorCode } from '../session-chain-log.js';
import { resolveKnownSessionScope } from './session-actions-helpers.js';
import { useSessionResume } from './use-session-resume.js';
import { useSessionRunActions } from './use-session-run-actions.js';
import { useSessionTranscriptActions } from './use-session-transcript-actions.js';
import {
  hydrateSessionsFromHost,
  nextScopeRequestGeneration,
  resolveHydrateScope,
} from '../session-list-hydrate.js';
import { getSessionListScopeMeta } from '../session-list-scope.js';

export type ModelOption = {
  providerId: string;
  protocol?: 'openai-compatible' | 'anthropic-compatible' | 'google-gemini';
  modelId: string;
  label: string;
  thinkingLevels?: readonly import('@piwin/contracts').ThinkingLevel[];
  reasoning?: boolean;
};

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
  setRenameDraft: Dispatch<SetStateAction<{ sessionId: string; name: string } | null>>;
  setHostLogEntries: Dispatch<SetStateAction<HostLogEntry[]>>;
  /**
   * Restore the composer model/thinking when a session is opened or resumed.
   * Host returns the last-used profile from the session index (or transcript).
   */
  onSessionComposerProfileRestored?: (profile: {
    model?: ModelRef;
    thinkingLevel?: import('@piwin/contracts').ThinkingLevel;
  }) => void;
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
    setRenameDraft,
    setHostLogEntries,
    onSessionComposerProfileRestored,
  } = args;
  const { locale } = useDesktopLocale();
  const pendingSessionCreations = useRef(new Map<string, Promise<string | null>>());
  const sessionListRequestGenerations = useRef(new Map<string, number>());
  const sessionListScopesRef = useRef(state.sessionListScopes);
  sessionListScopesRef.current = state.sessionListScopes;
  const {
    transcriptHistoryLoading,
    loadUserMessageIndex,
    handleJumpToHistoryAnchor,
    handleReturnToLiveTranscript,
    handleLoadOlderTranscript,
  } = useSessionTranscriptActions({
    hostClient,
    state,
    dispatch,
    dispatchNotification,
  });

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
    return toModelRef({
      providerId: option.providerId,
      modelId: option.modelId,
      ...(option.protocol !== undefined ? { protocol: option.protocol } : {}),
    });
  }, [modelOptions, selectedModelKey]);

  const hydrateSessions = useCallback(
    async (
      projectPathOrScope?: string | { kind: 'general' } | { kind: 'project'; projectPath: string },
      options?: {
        includeArchived?: boolean;
        order?: SessionListOrder;
      },
    ): Promise<SessionSummary[]> => {
      const scope = resolveHydrateScope(projectPathOrScope, state.activeScope);
      const { scopeKey, requestGeneration } = nextScopeRequestGeneration(
        sessionListRequestGenerations.current,
        scope,
      );
      const mutationEpochAtStart =
        getSessionListScopeMeta(sessionListScopesRef.current, scope)?.mutationEpoch ?? 0;
      return hydrateSessionsFromHost({
        hostClient,
        dispatch,
        showArchivedSessions,
        sessionListOrder,
        activeScope: state.activeScope,
        ...(projectPathOrScope !== undefined ? { projectPathOrScope } : {}),
        ...(options ? { options } : {}),
        requestGeneration,
        mutationEpoch: mutationEpochAtStart,
        isCurrentGeneration: (generation) =>
          sessionListRequestGenerations.current.get(scopeKey) === generation &&
          (getSessionListScopeMeta(sessionListScopesRef.current, scope)?.mutationEpoch ?? 0) ===
            mutationEpochAtStart,
      });
    },
    [dispatch, hostClient, sessionListOrder, showArchivedSessions, state.activeScope],
  );

  const {
    handleResumeSession,
    handleNewSession,
    confirmColdRestore,
    coldRestorePrompt,
    clearColdRestorePrompt,
    setColdRestorePrompt,
    bumpToDraft,
    beginNavigation,
    navigationEpochMatches,
  } = useSessionResume({
    hostClient,
    state,
    dispatch,
    dispatchNotification,
    locale,
    showArchivedSessions,
    ...(resolveSessionScopeHint ? { resolveSessionScopeHint } : {}),
    hydrateSessions,
    ...(onSessionComposerProfileRestored ? { onSessionComposerProfileRestored } : {}),
  });
  const {
    handlePause,
    handleResumeRun,
    handleAbort,
    handleCompact,
    handleCompactAbort,
    handlePermission,
  } = useSessionRunActions({
    hostClient,
    state,
    dispatch,
    dispatchNotification,
    locale,
  });

  const ensureSession = useCallback(
    async (options?: {
      projectPath?: string;
      alreadyTrusted?: boolean;
      scope?: { kind: 'general' } | { kind: 'project'; projectPath: string };
      sessionName?: string;
    }): Promise<string | null> => {
      const requestedScope = options?.scope;
      const requestedProjectPath =
        requestedScope?.kind === 'project'
          ? requestedScope.projectPath
          : (options?.projectPath ?? state.projectPath);
      const useGeneral =
        requestedScope?.kind === 'general' ||
        (!requestedScope && !requestedProjectPath && state.activeScope.kind === 'general');
      const scopeKey = useGeneral
        ? 'general'
        : requestedProjectPath
          ? `project:${requestedProjectPath}`
          : 'general';
      const existingCreation = pendingSessionCreations.current.get(scopeKey);
      if (existingCreation) {
        return existingCreation;
      }

      const createSession = async (): Promise<string | null> => {
        const createStartedAt = Date.now();
        let createInput: {
          scope?: { kind: 'general' } | { kind: 'project'; projectPath: string };
          projectPath?: string;
          model?: ModelRef;
          thinkingLevel?: import('@piwin/contracts').ThinkingLevel;
          sessionName?: string;
        };

        if (useGeneral) {
          createInput = sessionCreateInputForTransport(hostClient.getTransport(), {
            useGeneral: true,
            ...(options?.sessionName !== undefined ? { sessionName: options.sessionName } : {}),
          });
        } else {
          const projectPath = requestedProjectPath;
          if (!projectPath) {
            dispatchNotification(pushError('Open a project first'));
            return null;
          }
          const trusted = options?.alreadyTrusted === true || state.projectTrusted;
          if (!trusted) {
            dispatch({ type: 'project/trust-dialog', open: true });
            return null;
          }
          createInput = sessionCreateInputForTransport(hostClient.getTransport(), {
            useGeneral: false,
            projectKey: projectPath,
            ...(options?.sessionName !== undefined ? { sessionName: options.sessionName } : {}),
          });
        }
        const model = selectedModelRef();
        if (model) {
          createInput.model = model;
        }
        if (thinkingLevel) {
          createInput.thinkingLevel = thinkingLevel;
        }
        const created = await hostClient.request(
          {
            type: 'session/create',
            input: createInput,
          },
          { idempotencyKey: createGestureIdempotencyKey() },
        );
        if (!created.success) {
          logSessionChain({
            event: 'session/create-failed',
            scopeKey,
            elapsedMs: Date.now() - createStartedAt,
            errorCode: sessionChainErrorCode(created.error),
            hostInstanceId: hostClient.getHostInstanceId?.() ?? null,
          });
          dispatchNotification(pushError(created.error));
          return null;
        }
        const sessionId = (created.data as { sessionId: string }).sessionId;
        logSessionChain({
          event: 'session/create-ok',
          owner: sessionId,
          scopeKey,
          elapsedMs: Date.now() - createStartedAt,
          hostInstanceId: hostClient.getHostInstanceId?.() ?? null,
        });
        const createScope: SessionScope = useGeneral
          ? { kind: 'general' }
          : { kind: 'project', projectPath: requestedProjectPath ?? '' };
        const explicitName = options?.sessionName?.trim();
        if (explicitName) {
          dispatch({
            type: 'session/add',
            sessionId,
            name: explicitName,
            scope: createScope,
          });
        } else {
          dispatch({ type: 'session/set', sessionId, ifIdle: true });
          dispatch({
            type: 'session/update',
            session: {
              id: sessionId,
              name: '',
              scope: createScope,
            },
          });
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
      dispatchNotification,
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
      options?: {
        autoTrust?: boolean;
        resumeSessionId?: string;
        switchSession?: boolean;
        quiet?: boolean;
      },
    ): Promise<void> => {
      const resumeSessionId = options?.resumeSessionId;
      const navigationEpoch = beginNavigation(resumeSessionId ?? null);
      const openOptions =
        options?.autoTrust !== undefined ? { autoTrust: options.autoTrust } : undefined;
      const activation = await activateProjectOnHost(
        (command) => hostClient.request(command),
        hostClient.getTransport(),
        path,
        openOptions,
      );
      if (!navigationEpochMatches(navigationEpoch)) {
        return;
      }
      if (!activation.ok) {
        if (options?.quiet !== true) {
          dispatchNotification(pushError(activation.error));
        }
        return;
      }
      if (!activation.trusted) {
        dispatch({ type: 'project/set', path: activation.path, trusted: false });
        setProjectPickerOpen(false);
        dispatchNotification(
          pushError(
            'This project is not trusted on the Host yet. Trust it on the machine running the Host.',
          ),
        );
        return;
      }
      const openedPath = activation.path;
      dispatch({ type: 'project/set', path: openedPath, trusted: true });
      setProjectPickerOpen(false);
      // Hydrate sessions for opened project. Do not force-switch session when simply opening/expanding a folder.
      const sessions = await hydrateSessions(openedPath);
      // Also hydrate general sessions in the background so the Conversations
      // sidebar section stays populated while a project is active.
      void hydrateSessions({ kind: 'general' }, { includeArchived: showArchivedSessions });
      if (resumeSessionId) {
        await handleResumeSession(resumeSessionId, {
          scope: { kind: 'project', projectPath: openedPath },
          projectAlreadyActivated: true,
          ...(options?.quiet === true ? { quiet: true } : {}),
        });
      } else if (options?.switchSession) {
        if (sessions[0]) {
          await handleResumeSession(sessions[0].id, {
            scope: { kind: 'project', projectPath: openedPath },
            projectAlreadyActivated: true,
          });
        } else {
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
      beginNavigation,
      navigationEpochMatches,
    ],
  );

  const handleOpenWorkspaceClick = useCallback(async (): Promise<void> => {
    const hostHomeDirectory = hostClient.getRemoteCapabilities()?.homeDirectory;
    const result = await pickOrPromptWorkspaceFolder({
      projectPath: state.projectPath,
      projectInput,
      title: locale === 'zh-CN' ? '打开工作区' : 'Open workspace',
      ...(hostHomeDirectory ? { hostHomeDirectory } : {}),
    });
    if (result.kind === 'picked') {
      await handleOpenProject(result.path);
      return;
    }
    if (result.kind === 'dialog') {
      setProjectPickerOpen(true);
    }
  }, [
    handleOpenProject,
    hostClient,
    locale,
    projectInput,
    setProjectPickerOpen,
    state.projectPath,
  ]);

  const handleBrowseProject = handleOpenWorkspaceClick;

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
        dispatchNotification(pushError(response.error));
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
      dispatchNotification,
      ensureSession,
      handleResumeSession,
      hostClient,
      hydrateSessions,
      setHostLogEntries,
      state.projectPath,
    ],
  );

  const handleExportSession = useCallback(
    async (options?: { format?: 'md' | 'html'; redactTools?: boolean }): Promise<void> => {
      const sessionId = state.activeSessionId;
      if (!sessionId) {
        dispatchNotification(pushError('Select a session before exporting.'));
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
        dispatchNotification(pushError(response.error));
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
    [dispatchNotification, hostClient, setHostLogEntries, state.activeSessionId],
  );

  const handleTogglePin = useCallback(
    async (sessionId: string, currentlyPinned: boolean): Promise<void> => {
      const response = await hostClient.request({
        type: currentlyPinned ? 'session/unpin' : 'session/pin',
        sessionId,
      });
      if (!response.success) {
        dispatchNotification(pushError(response.error));
        return;
      }
      const data = response.data as {
        session?: SessionSummary;
        isPinned?: boolean;
        pinnedAt?: string;
      };
      const session = data.session;
      const existing = findSessionForLookup(sessionId, {
        sessions: state.sessions,
        generalSessions: state.generalSessions,
        projectSessionsByPath: state.projectSessionsByPath,
      });
      const nextSession: SessionListItemUi = {
        id: sessionId,
        name: session?.name ?? existing?.name ?? sessionId.slice(0, 8),
      };
      if (session?.scope) nextSession.scope = session.scope;
      else if (existing?.scope) nextSession.scope = existing.scope;
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
    [dispatch, dispatchNotification, hostClient, state],
  );

  const handleRenameSession = useCallback(
    async (sessionId: string, name: string): Promise<void> => {
      const response = await hostClient.request({
        type: 'session/rename',
        sessionId,
        name,
      });
      if (!response.success) {
        dispatchNotification(pushError(response.error));
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
      const wasActive = state.activeSessionId === sessionId;
      const nextSessionId = wasActive
        ? findAdjacentSessionId({
            activeSessionId: sessionId,
            sessions: state.sessions,
            fallbackSessions:
              state.activeScope.kind === 'project' ? state.generalSessions : undefined,
          })
        : null;

      const response = await hostClient.request({ type: 'session/archive', sessionId });
      if (!response.success) {
        dispatchNotification(pushError(response.error));
        return;
      }
      dispatchNotification(pushSuccess('Agent archived'));
      if (wasActive) {
        if (!showArchivedSessions) {
          dispatch({ type: 'session/remove', sessionId });
        }
        if (nextSessionId) {
          await handleResumeSession(nextSessionId);
        } else {
          bumpToDraft();
          dispatch({ type: 'session/clear-active' });
        }
        await hydrateSessions(sessionScope, { includeArchived: showArchivedSessions });
      } else {
        if (showArchivedSessions) {
          await hydrateSessions(sessionScope, {
            includeArchived: true,
          });
        } else {
          dispatch({ type: 'session/remove', sessionId });
          await hydrateSessions(sessionScope, { includeArchived: false });
        }
      }
    },
    [
      dispatch,
      dispatchNotification,
      bumpToDraft,
      handleResumeSession,
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
        dispatchNotification(pushError(response.error));
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
      const response = await hostClient.request(
        { type: 'session/delete', sessionId },
        { idempotencyKey: createGestureIdempotencyKey() },
      );
      if (!response.success) {
        dispatchNotification(pushError(response.error));
        return false;
      }
      forgetTranscriptScrollPosition(sessionId);
      const wasActive = state.activeSessionId === sessionId;
      dispatch({ type: 'session/remove', sessionId });
      if (wasActive) {
        bumpToDraft();
        dispatch({ type: 'session/clear-active' });
      }
      dispatchNotification(pushSuccess('Agent deleted permanently'));
      return true;
    },
    [bumpToDraft, dispatch, dispatchNotification, hostClient, state],
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
        dispatchNotification(pushError(response.error));
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
        dispatchNotification(pushError(response.error));
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
      await handleResumeSession(data.sessionId, {
        scope: { kind: 'project', projectPath },
      });
      return true;
    },
    [dispatch, dispatchNotification, handleResumeSession, hostClient],
  );

  const handleForkSession = useCallback(
    async (sessionId: string, messageId?: string): Promise<void> => {
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
        ...(messageId !== undefined ? { messageId } : {}),
        workspaceStrategy: 'shared',
        messageProjection: 'none',
      });
      if (!response.success) {
        dispatchNotification(pushError(response.error));
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
      const session = findSessionForLookup(sessionId, {
        sessions: state.sessions,
        generalSessions: state.generalSessions,
        projectSessionsByPath: state.projectSessionsByPath,
      });
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
            dispatchNotification(pushError('Could not copy session ID'));
          }
          break;
        case 'duplicate':
          await handleDuplicateSession(sessionId);
          break;
        case 'fork-chat':
          await handleForkSession(sessionId);
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
        case 'restore-pack':
          if (session?.storage && isSessionBodyOffloaded(session.storage)) {
            setColdRestorePrompt({ sessionId, storage: session.storage });
          }
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
      dispatchNotification,
      handleDuplicateSession,
      handleForkSession,
      handleExportSession,
      handleResumeSession,
      handleTogglePin,
      handleUnarchiveSession,
      setRenameDraft,
      state.activeSessionId,
      state.generalSessions,
      state.projectSessionsByPath,
      state.sessions,
    ],
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
    coldRestorePrompt,
    confirmColdRestore,
    clearColdRestorePrompt,
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
    handlePause,
    handleResumeRun,
    handleAbort,
    handleCompact,
    handleCompactAbort,
    handlePermission,
    bumpToDraft,
  };
}
