/**
 * Project open/trust + session lifecycle + chat ops (edit/retry/abort/compact).
 */
import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import type {
  ExecutionMode,
  MediaAttachmentRef,
  ModelRef,
  PermissionDecision,
  PermissionRememberScope,
  SessionSummary,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import type { HostClient } from '../host-client';
import type { ChatUiAction, ChatUiState, SessionListItemUi } from '../chat-reducer';
import type { NotificationAction } from '../notification-queue';
import { pushError, pushSuccess } from '../notification-queue';
import { pushInfo } from '../notification-queue';
import { appendHostLogEntry, type HostLogEntry } from '../HostLogPanel';
import { applyAgentModeToPrompt, type AgentModeId } from '../agent-mode';
import type { SessionRowMenuAction } from '../session-row-menu';
import { isDesktopShellRuntime, pickProjectDirectory } from '../pick-project-directory';
import { mapSummariesToListItems, summaryToListItem } from './session-list-item';
import { resolveSessionOutline } from '../transcript-outline';

export type ModelOption = {
  providerId: string;
  protocol: 'openai-compatible' | 'anthropic-compatible' | 'google-gemini';
  modelId: string;
  label: string;
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
  executionMode: ExecutionMode;
  selectedModelKey: string;
  modelOptions: ModelOption[];
  agentMode: AgentModeId;
  setEditingMessageId: Dispatch<SetStateAction<string | null>>;
  setRenameDraft: Dispatch<SetStateAction<{ sessionId: string; name: string } | null>>;
  setHostLogEntries: Dispatch<SetStateAction<HostLogEntry[]>>;
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
    executionMode,
    selectedModelKey,
    modelOptions,
    agentMode,
    setEditingMessageId,
    setRenameDraft,
    setHostLogEntries,
  } = args;
  // Multiple event handlers can ask for the first session before React has
  // committed activeSessionId. Share one create request per selected scope.
  const pendingSessionCreations = useRef(new Map<string, Promise<string | null>>());

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

  const hydrateSessions = useCallback(
    async (
      projectPathOrScope?: string | { kind: 'general' } | { kind: 'project'; projectPath: string },
      options?: { includeArchived?: boolean },
    ): Promise<SessionSummary[]> => {
      const includeArchived = options?.includeArchived ?? showArchivedSessions;
      let listed;
      if (
        projectPathOrScope &&
        typeof projectPathOrScope === 'object' &&
        projectPathOrScope.kind === 'general'
      ) {
        listed = await hostClient.request({
          type: 'session/list',
          scope: { kind: 'general' },
          ...(includeArchived ? { includeArchived: true } : {}),
        });
      } else if (
        projectPathOrScope &&
        typeof projectPathOrScope === 'object' &&
        projectPathOrScope.kind === 'project'
      ) {
        listed = await hostClient.request({
          type: 'session/list',
          scope: projectPathOrScope,
          projectPath: projectPathOrScope.projectPath,
          ...(includeArchived ? { includeArchived: true } : {}),
        });
      } else if (typeof projectPathOrScope === 'string' && projectPathOrScope.trim()) {
        listed = await hostClient.request({
          type: 'session/list',
          projectPath: projectPathOrScope,
          ...(includeArchived ? { includeArchived: true } : {}),
        });
      } else if (state.activeScope.kind === 'general' || !state.projectPath) {
        listed = await hostClient.request({
          type: 'session/list',
          scope: { kind: 'general' },
          ...(includeArchived ? { includeArchived: true } : {}),
        });
      } else {
        listed = await hostClient.request({
          type: 'session/list',
          projectPath: state.projectPath,
          ...(includeArchived ? { includeArchived: true } : {}),
        });
      }
      if (!listed.success) {
        dispatch({ type: 'error', message: `Could not load sessions: ${listed.error}` });
        return [];
      }
      const data = listed.data as { sessions?: SessionSummary[] } | undefined;
      const sessions = mapSummariesToListItems(data?.sessions ?? []);
      const visible = includeArchived
        ? sessions.filter((session) => session.isArchived === true)
        : sessions.filter((session) => session.isArchived !== true);
      // Determine the scope that was actually listed so we can dispatch the
      // correct hydrate action. General sessions go into generalSessions
      // (the reducer also mirrors them into sessions when general is the
      // active scope); project sessions go into sessions only.
      const listedGeneral =
        (typeof projectPathOrScope === 'object' && projectPathOrScope.kind === 'general') ||
        (!projectPathOrScope && state.activeScope.kind === 'general') ||
        (!projectPathOrScope && !state.projectPath);
      if (listedGeneral) {
        dispatch({ type: 'session/hydrate-general', sessions: visible });
      } else {
        dispatch({ type: 'session/hydrate', sessions: visible });
      }
      return (data?.sessions ?? []).filter((session) =>
        includeArchived ? session.isArchived === true : session.isArchived !== true,
      );
    },
    [dispatch, hostClient, showArchivedSessions, state.activeScope, state.projectPath],
  );

  const handleResumeSession = useCallback(
    async (sessionId: string): Promise<void> => {
      dispatch({ type: 'session/set', sessionId });
      const resumed = await hostClient.request({
        type: 'session/resume',
        sessionId,
      });
      if (!resumed.success) {
        dispatch({
          type: 'error',
          message: `${resumed.error} — start a New session to continue in this process.`,
        });
        return;
      }
      const data = resumed.data as {
        sessionId: string;
        live: boolean;
        messages?: SessionTranscriptMessage[];
        outline?: import('@piwin/contracts').SessionOutlineNode[];
      };
      const messages = data.messages ?? [];
      if (messages.length === 0) {
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
          });
          if (!data.live) {
            dispatchNotification(
              pushInfo(
                'Session history restored (read-only shell). Sending will re-open a live agent.',
              ),
            );
          }
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
        outline,
      });
      if (!data.live) {
        dispatchNotification(
          pushInfo(
            'Session history restored (read-only shell). Sending will re-open a live agent.',
          ),
        );
      }
    },
    [dispatch, dispatchNotification, hostClient],
  );

  const ensureSession = useCallback(
    async (options?: {
      projectPath?: string;
      alreadyTrusted?: boolean;
      scope?: { kind: 'general' } | { kind: 'project'; projectPath: string };
      executionMode?: ExecutionMode;
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
          executionMode?: ExecutionMode;
          sessionName?: string;
        };

        if (useGeneral) {
          createInput = {
            scope: { kind: 'general' },
            executionMode: options?.executionMode ?? executionMode,
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
            executionMode: options?.executionMode ?? executionMode,
          };
        }
        if (options?.sessionName) {
          createInput.sessionName = options.sessionName;
        }
        const model = selectedModelRef();
        if (model) {
          createInput.model = model;
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
        dispatch({
          type: 'session/add',
          sessionId,
          name: options?.sessionName ?? `session-${sessionId.slice(0, 8)}`,
        });
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
      executionMode,
      hostClient,
      selectedModelRef,
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
      const sessions = await hydrateSessions(openedPath);
      // Also hydrate general sessions in the background so the Conversations
      // sidebar section stays populated while a project is active.
      void hydrateSessions({ kind: 'general' }, { includeArchived: showArchivedSessions });
      if (resumeSessionId) {
        const sessionToResume = sessions.find((session) => session.id === resumeSessionId);
        if (sessionToResume) {
          await handleResumeSession(sessionToResume.id);
        }
      } else if (options?.switchSession) {
        if (sessions[0]) {
          await handleResumeSession(sessions[0].id);
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

  const handleNewSession = useCallback(
    async (options?: {
      scope?: { kind: 'general' } | { kind: 'project'; projectPath: string };
    }): Promise<void> => {
      await ensureSession(options);
    },
    [ensureSession],
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
      try {
        const dialog = await import('@tauri-apps/plugin-dialog').catch(() => null);
        if (dialog && typeof dialog.save === 'function') {
          const selected = await dialog.save({
            title: 'Export session',
            defaultPath: defaultName,
            filters: [
              format === 'html'
                ? { name: 'HTML', extensions: ['html'] }
                : { name: 'Markdown', extensions: ['md'] },
            ],
          });
          if (selected === null) {
            return;
          }
          if (typeof selected === 'string' && selected.trim()) {
            outputPath = selected.trim();
          }
        } else if (typeof window !== 'undefined' && !('__TAURI_INTERNALS__' in window)) {
          const fallback = window.prompt(
            'Export path (host writes the file; leave empty for default)',
            defaultName,
          );
          if (fallback === null) {
            return;
          }
          if (fallback.trim()) {
            outputPath = fallback.trim();
          }
        }
      } catch {
        // host default path
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
    [dispatch, hostClient, state.sessions],
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
      const response = await hostClient.request({ type: 'session/archive', sessionId });
      if (!response.success) {
        dispatch({ type: 'error', message: response.error });
        dispatchNotification(pushError(response.error));
        return;
      }
      dispatchNotification(pushSuccess('Agent archived'));
      if (showArchivedSessions) {
        if (state.projectPath) {
          await hydrateSessions(state.projectPath, { includeArchived: true });
        }
      } else {
        const wasActive = state.activeSessionId === sessionId;
        if (wasActive) {
          // Keep transcript visible; remove only from the active list.
          dispatch({ type: 'session/hide-from-list', sessionId });
        } else {
          dispatch({ type: 'session/remove', sessionId });
          if (state.projectPath) {
            await hydrateSessions(state.projectPath, { includeArchived: false });
          }
        }
      }
    },
    [
      dispatch,
      dispatchNotification,
      hostClient,
      hydrateSessions,
      showArchivedSessions,
      state.activeSessionId,
      state.projectPath,
    ],
  );

  const handleUnarchiveSession = useCallback(
    async (sessionId: string): Promise<void> => {
      const response = await hostClient.request({ type: 'session/unarchive', sessionId });
      if (!response.success) {
        dispatch({ type: 'error', message: response.error });
        return;
      }
      if (state.activeSessionId === sessionId) {
        dispatch({ type: 'session/mark-archived-active', archived: false });
      }
      dispatchNotification(pushSuccess('Agent restored'));
      if (state.projectPath) {
        await hydrateSessions(state.projectPath, { includeArchived: showArchivedSessions });
      }
    },
    [
      dispatch,
      dispatchNotification,
      hostClient,
      hydrateSessions,
      showArchivedSessions,
      state.activeSessionId,
      state.projectPath,
    ],
  );

  const confirmDeleteSession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      const response = await hostClient.request({ type: 'session/delete', sessionId });
      if (!response.success) {
        dispatch({ type: 'error', message: response.error });
        return false;
      }
      const wasActive = state.activeSessionId === sessionId;
      dispatch({ type: 'session/remove', sessionId });
      if (wasActive) {
        dispatch({ type: 'session/clear-active' });
      }
      dispatchNotification(pushSuccess('Agent deleted permanently'));
      if (state.projectPath) {
        await hydrateSessions(state.projectPath, {
          includeArchived: showArchivedSessions,
        });
      }
      return true;
    },
    [
      dispatch,
      dispatchNotification,
      hostClient,
      hydrateSessions,
      showArchivedSessions,
      state.activeSessionId,
      state.projectPath,
    ],
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
      const response = await hostClient.request({
        type: 'session/duplicate',
        sessionId,
      });
      if (!response.success) {
        dispatch({ type: 'error', message: response.error });
        return;
      }
      const data = response.data as {
        sessionId: string;
        session?: SessionSummary;
        messages?: SessionTranscriptMessage[];
      };
      const listItem = data.session
        ? summaryToListItem(data.session, data.sessionId)
        : { id: data.sessionId, name: 'Copy of session' };
      dispatch({ type: 'session/update', session: listItem });
      dispatchNotification(pushSuccess(`Duplicated as “${listItem.name}”`));
      await handleResumeSession(data.sessionId);
      if (data.messages && data.messages.length > 0) {
        dispatch({
          type: 'session/load-messages',
          sessionId: data.sessionId,
          messages: data.messages,
        });
      }
    },
    [dispatch, dispatchNotification, handleResumeSession, hostClient],
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
            dispatchNotification(pushError('Could not copy session ID'));
          }
          break;
        case 'duplicate':
          await handleDuplicateSession(sessionId);
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

  const handleEditAndResend = useCallback(
    async (messageId: string, nextText: string): Promise<void> => {
      if (!state.activeSessionId || state.streaming) {
        return;
      }
      const text = nextText.trim();
      if (!text) {
        return;
      }
      if (!state.projectTrusted) {
        dispatch({ type: 'project/trust-dialog', open: true });
        return;
      }
      const truncate = await hostClient.request({
        type: 'session/truncate-from',
        sessionId: state.activeSessionId,
        messageId,
      });
      if (!truncate.success) {
        dispatch({ type: 'error', message: truncate.error });
        return;
      }
      const truncData = truncate.data as { messages?: SessionTranscriptMessage[] };
      dispatch({
        type: 'session/truncate',
        sessionId: state.activeSessionId,
        messages: truncData.messages ?? [],
      });
      setEditingMessageId(null);
      const promptText = applyAgentModeToPrompt(agentMode, text);
      dispatch({ type: 'user/send', text });
      const response = await hostClient.request({
        type: 'session/prompt',
        sessionId: state.activeSessionId,
        input: { text: promptText },
      });
      if (!response.success) {
        dispatch({ type: 'error', message: response.error });
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
      dispatch,
      hostClient,
      setEditingMessageId,
      state.activeSessionId,
      state.projectTrusted,
      state.streaming,
    ],
  );

  const handleRetryFromMessage = useCallback(
    async (messageId: string): Promise<void> => {
      const message = state.messages.find((item) => item.id === messageId);
      if (!message || message.role !== 'user' || !state.activeSessionId || state.streaming) {
        return;
      }
      const text = message.text.trim();
      if (!text && message.attachments.length === 0) {
        return;
      }
      if (!state.projectTrusted) {
        dispatch({ type: 'project/trust-dialog', open: true });
        return;
      }
      const truncate = await hostClient.request({
        type: 'session/truncate-from',
        sessionId: state.activeSessionId,
        messageId,
      });
      if (!truncate.success) {
        dispatch({ type: 'error', message: truncate.error });
        return;
      }
      const truncData = truncate.data as { messages?: SessionTranscriptMessage[] };
      dispatch({
        type: 'session/truncate',
        sessionId: state.activeSessionId,
        messages: truncData.messages ?? [],
      });
      const promptText = applyAgentModeToPrompt(agentMode, text);
      dispatch({
        type: 'user/send',
        text,
        attachments: message.attachments,
      });
      const input: { text: string; attachments?: MediaAttachmentRef[] } = {
        text: promptText,
      };
      if (message.attachments.length > 0) {
        input.attachments = message.attachments;
      }
      const response = await hostClient.request({
        type: 'session/prompt',
        sessionId: state.activeSessionId,
        input,
      });
      if (!response.success) {
        dispatch({ type: 'error', message: response.error });
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
      dispatch,
      hostClient,
      state.activeSessionId,
      state.messages,
      state.projectTrusted,
      state.streaming,
    ],
  );

  const handleAbort = useCallback(async (): Promise<void> => {
    if (!state.activeSessionId || state.runPhase === 'aborting') {
      return;
    }
    dispatch({ type: 'run/aborting' });
    const response = await hostClient.request({
      type: 'session/abort',
      sessionId: state.activeSessionId,
      ...(state.activeRunId ? { runId: state.activeRunId } : {}),
    });
    if (!response.success) {
      dispatch({ type: 'error', message: response.error });
    }
  }, [dispatch, hostClient, state.activeRunId, state.activeSessionId, state.runPhase]);

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
    handleOpenWorkspaceClick,
    handleBrowseProject,
    handleOpenProject,
    handleTrustProject,
    ensureSession,
    handleNewSession,
    handleResumeSession,
    handleExportSession,
    handleTogglePin,
    handleRenameSession,
    handleArchiveSession,
    handleUnarchiveSession,
    handleDeleteSession,
    confirmDeleteSession,
    handleDuplicateSession,
    handleSessionMenuAction,
    handleEditAndResend,
    handleRetryFromMessage,
    handleAbort,
    handleCompact,
    handleCompactAbort,
    handlePermission,
  };
}
