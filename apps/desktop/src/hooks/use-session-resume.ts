import { useCallback, useRef, useState } from 'react';
import type { Dispatch } from 'react';
import type {
  ModelRef,
  SessionResumeData,
  SessionScope,
  SessionStorageInfo,
  SessionSummary,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import { parseSessionContextSnapshot } from '@piwin/contracts';
import type { HostClient } from '../host/host-client';
import type { SessionOrchestrationRestore } from './use-composer-orchestration-controls';
import { requestQueuedTurnQueue } from '../conversation/queued-turn-queue-request.js';
import type { ChatUiAction, ChatUiState } from '../conversation/chat-reducer';
import type { NotificationAction } from '../notifications/notification-queue';
import { pushError, pushInfo } from '../notifications/notification-queue';
import { resolveSessionOutline } from '../conversation/transcript-outline';
import { nativeHistorySyncFailure, syncNativeHistory } from '../platform/native-history-sync.js';
import { chooseSessionPackPath } from '../session/session-pack-dialog';
import { isSessionBodyOffloaded } from '../session/session-storage-ui';
import { activateProjectOnHost } from '../host/remote-session-hydrate';
import { isWorkbenchHostTeardownError } from '../workbench/workbench-host-teardown.js';
import { shouldBlockRemoteHostGesture } from '../host/host-reconnect-gate.js';
import { hostReconnectNotice } from '../host/host-problem-copy.js';
import {
  beginResumeRequest,
  bumpSelectionEpoch,
  createSessionSelectionGuard,
  resetGuardHostInstance,
  resumeTicketMatches,
  selectSessionForResume,
  takeIfResumeCurrent,
  type SessionSelectionGuard,
} from '../session/session-resume-guard.js';

export function useSessionResume(input: {
  hostClient: HostClient;
  state: ChatUiState;
  dispatch: Dispatch<ChatUiAction>;
  dispatchNotification: Dispatch<NotificationAction>;
  locale: import('../i18n/desktop-locale.js').DesktopLocale;
  showArchivedSessions: boolean;
  resolveSessionScopeHint?: (sessionId: string) => SessionScope | undefined;
  hydrateSessions: (
    projectPathOrScope?: string | { kind: 'general' } | { kind: 'project'; projectPath: string },
    options?: { includeArchived?: boolean },
  ) => Promise<SessionSummary[]>;
  onSessionComposerProfileRestored?: (profile: {
    model?: ModelRef;
    thinkingLevel?: import('@piwin/contracts').ThinkingLevel;
  }) => void;
  onSessionOrchestrationRestored?: (restore: SessionOrchestrationRestore) => void;
}) {
  const {
    hostClient,
    state,
    dispatch,
    dispatchNotification,
    locale,
    showArchivedSessions,
    resolveSessionScopeHint,
    hydrateSessions,
    onSessionComposerProfileRestored,
    onSessionOrchestrationRestored,
  } = input;
  const selectionGuardRef = useRef(createSessionSelectionGuard(hostClient.getHostInstanceId()));
  const nativeHistoryAttemptsRef = useRef(new Map<string, string>());
  const resumeSessionRef = useRef<
    ((sessionId: string, context?: { refresh?: boolean; nativeHistorySynced?: true }) => Promise<void>) | null
  >(null);
  const [coldRestorePrompt, setColdRestorePrompt] = useState<{
    sessionId: string;
    storage: SessionStorageInfo;
  } | null>(null);

  const syncHostInstance = useCallback((): SessionSelectionGuard => {
    const hostInstanceId = hostClient.getHostInstanceId();
    const next = resetGuardHostInstance(selectionGuardRef.current, hostInstanceId);
    if (next !== selectionGuardRef.current) {
      selectionGuardRef.current = next;
      nativeHistoryAttemptsRef.current.clear();
      dispatch({ type: 'context-telemetry/host-instance', hostInstanceId });
    }
    return selectionGuardRef.current;
  }, [dispatch, hostClient]);

  const bumpToDraft = useCallback((): void => {
    selectionGuardRef.current = bumpSelectionEpoch(syncHostInstance(), {
      selectedSessionId: null,
    });
  }, [syncHostInstance]);

  const beginNavigation = useCallback((selectedSessionId: string | null): number => {
    selectionGuardRef.current = bumpSelectionEpoch(syncHostInstance(), {
      selectedSessionId,
    });
    return selectionGuardRef.current.selectionEpoch;
  }, [syncHostInstance]);

  const navigationEpochMatches = useCallback((epoch: number): boolean => {
    return selectionGuardRef.current.selectionEpoch === epoch;
  }, []);

  const hydrateQueuedTurns = useCallback(
    async (sessionId: string, ticketMatches: () => boolean): Promise<void> => {
      const hydrate = await requestQueuedTurnQueue(hostClient, sessionId);
      if (hydrate === null || !ticketMatches()) return;
      dispatch(hydrate);
    },
    [dispatch, hostClient],
  );

  const handleResumeSession = useCallback(
    async (
      sessionId: string,
      context?: {
        scope?: SessionScope;
        quiet?: boolean;
        /** Caller already ran project/open for `scope`. Skip a second activation. */
        projectAlreadyActivated?: boolean;
        /** Reconnect / cold-restore / other explicit refresh. */
        refresh?: boolean;
        /** This reload follows an already completed native snapshot. */
        nativeHistorySynced?: true;
      },
    ): Promise<void> => {
      if (shouldBlockRemoteHostGesture(hostClient)) {
        dispatchNotification(pushInfo(hostReconnectNotice(locale)));
        return;
      }
      if (
        context?.refresh !== true &&
        state.activeSessionId === sessionId &&
        (state.awaitingTranscript || state.transcriptOwnerSessionId === sessionId)
      ) {
        return;
      }
      syncHostInstance();
      selectionGuardRef.current = selectSessionForResume(
        selectionGuardRef.current,
        sessionId,
        hostClient.getHostInstanceId(),
      );
      const started = beginResumeRequest(selectionGuardRef.current, sessionId);
      selectionGuardRef.current = started.guard;
      const ticketMatches = (): boolean =>
        resumeTicketMatches(selectionGuardRef.current, started.ticket);

      // `context.scope` is where the session belongs. Continue-in-project
      // passes the project while the shell is still on General, so compare
      // against the live UI scope when deciding whether to activate.
      const currentUiScope = state.activeScope;
      const destinationScope = context?.scope ?? resolveSessionScopeHint?.(sessionId);
      const knownProjectPath =
        Object.entries(state.projectSessionsByPath).find(([, list]) =>
          list.some((session) => session.id === sessionId),
        )?.[0] ?? (destinationScope?.kind === 'project' ? destinationScope.projectPath : undefined);
      const knownGeneral =
        state.generalSessions.some((session) => session.id === sessionId) ||
        destinationScope?.kind === 'general';
      const existingListItem =
        knownProjectPath != null
          ? state.projectSessionsByPath[knownProjectPath]?.find(
              (session) => session.id === sessionId,
            )
          : (state.generalSessions.find((session) => session.id === sessionId) ??
            state.sessions.find((session) => session.id === sessionId));

      if (isSessionBodyOffloaded(existingListItem?.storage)) {
        const storage = existingListItem?.storage;
        if (storage) {
          setColdRestorePrompt({ sessionId, storage });
        }
        return;
      }

      if (!ticketMatches()) return;
      dispatch({ type: 'session/set', sessionId, awaitTranscript: true });
      // Resume is a durable read: it needs no active project or agent runtime.
      // Start it alongside activation instead of paying both round trips in order.
      const resumeRequest = hostClient.request({ type: 'session/resume', sessionId });

      if (
        knownProjectPath &&
        context?.projectAlreadyActivated !== true &&
        (currentUiScope.kind !== 'project' || currentUiScope.projectPath !== knownProjectPath)
      ) {
        const activation = await activateProjectOnHost(
          (command) => hostClient.request(command),
          hostClient.getTransport(),
          knownProjectPath,
        );
        if (!ticketMatches()) return;
        if (!activation.ok) {
          dispatchNotification(pushError(activation.error));
          return;
        }
        if (!activation.trusted) {
          dispatch({
            type: 'project/set',
            path: activation.path,
            trusted: false,
            keepActiveSession: true,
          });
          dispatchNotification(pushError('Project is not trusted on the Host.'));
          return;
        }
        dispatch({
          type: 'project/set',
          path: activation.path,
          trusted: true,
          keepActiveSession: true,
        });
        void hydrateSessions(activation.path);
        void hydrateSessions({ kind: 'general' }, { includeArchived: showArchivedSessions });
      }
      if (
        knownGeneral &&
        !knownProjectPath &&
        currentUiScope.kind === 'project' &&
        context?.projectAlreadyActivated !== true
      ) {
        if (!ticketMatches()) return;
        dispatch({ type: 'project/clear', keepActiveSession: true });
        void hydrateSessions({ kind: 'general' }, { includeArchived: showArchivedSessions });
      }
      const resumed = await resumeRequest;
      if (!ticketMatches()) return;
      if (!resumed.success) {
        if (context?.quiet !== true) {
          dispatchNotification(
            pushError(
              isWorkbenchHostTeardownError(resumed.error)
                ? hostReconnectNotice(locale)
                : `${resumed.error} — start a New session to continue in this process.`,
            ),
          );
        }
        dispatch({ type: 'context-telemetry/invalidate', sessionId });
        dispatch({
          type: 'session/load-messages',
          sessionId,
          messages: [],
        });
        return;
      }
      const data = resumed.data as SessionResumeData & {
        contextUsage?: import('@piwin/contracts').ContextUsageSnapshot;
      };
      const nativeHistoryKey = `${started.ticket.hostInstanceId ?? ''}:${sessionId}`;
      const nativeHistoryVersion = state.sessionEntitiesById[sessionId]?.updatedAt ?? '';
      if (data.nativeHistory === 'unsynced' && context?.nativeHistorySynced !== true &&
          nativeHistoryAttemptsRef.current.get(nativeHistoryKey) !== nativeHistoryVersion) {
        // Retry when native work advances, but never recurse from a snapshot's
        // own refresh while the native actor continues writing.
        nativeHistoryAttemptsRef.current.set(nativeHistoryKey, nativeHistoryVersion);
        // Never gate the paint on the agent: the transcript below settles
        // first, then a successful replay reloads it.
        void syncNativeHistory(hostClient, sessionId).then(async (result) => {
          if (!ticketMatches()) return;
          if (result.ok) {
            await resumeSessionRef.current?.(sessionId, { refresh: true, nativeHistorySynced: true });
          } else if (context?.quiet !== true) {
            dispatchNotification(pushError(nativeHistorySyncFailure(locale, result.error)));
          }
        });
      }
      if (data.activeRun) {
        dispatch({ type: 'run/updated', run: data.activeRun });
      }
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
        (currentUiScope.kind !== 'project' ||
          currentUiScope.projectPath !== resumedProjectPath) &&
        knownProjectPath !== resumedProjectPath
      ) {
        const activation = await activateProjectOnHost(
          (command) => hostClient.request(command),
          hostClient.getTransport(),
          resumedProjectPath,
        );
        if (!ticketMatches()) return;
        if (activation.ok && activation.trusted) {
          dispatch({
            type: 'project/set',
            path: activation.path,
            trusted: true,
            keepActiveSession: true,
          });
          void hydrateSessions(activation.path, {
            includeArchived: showArchivedSessions,
          });
          void hydrateSessions({ kind: 'general' }, { includeArchived: showArchivedSessions });
          // Keep the session/set from before resume. Re-selecting the same id
          // after project/set would drop Send until admission runs again.
        } else if (!activation.ok) {
          dispatch({ type: 'error', message: activation.error });
        }
      }
      if (
        data.scope?.kind === 'general' &&
        currentUiScope.kind === 'project' &&
        !knownGeneral &&
        !resumedProjectPath
      ) {
        if (!ticketMatches()) return;
        dispatch({ type: 'project/clear', keepActiveSession: true });
        void hydrateSessions({ kind: 'general' }, { includeArchived: showArchivedSessions });
      }
      if (!ticketMatches()) return;
      if (data.scope || data.name || data.model || data.thinkingLevel !== undefined) {
        dispatch({
          type: 'session/update',
          session: {
            id: sessionId,
            name: data.name ?? existingListItem?.name ?? '',
            ...(data.scope ? { scope: data.scope } : {}),
            ...(data.model ? { model: data.model } : {}),
            ...(data.thinkingLevel !== undefined ? { thinkingLevel: data.thinkingLevel } : {}),
          },
        });
      }
      void (async () => {
        const childrenResponse = await hostClient.request({
          type: 'session/list-children',
          parentSessionId: sessionId,
        });
        if (!childrenResponse.success || !ticketMatches()) {
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
      const restoredProfile = takeIfResumeCurrent(selectionGuardRef.current, started.ticket, {
        ...(data.model ? { model: data.model } : {}),
        ...(data.thinkingLevel !== undefined ? { thinkingLevel: data.thinkingLevel } : {}),
      });
      if (
        restoredProfile &&
        (restoredProfile.model !== undefined || restoredProfile.thinkingLevel !== undefined)
      ) {
        onSessionComposerProfileRestored?.(restoredProfile);
      }
      const restoredOrchestration = takeIfResumeCurrent(
        selectionGuardRef.current,
        started.ticket,
        {
          sessionId,
          ...(data.orchestrationSchemeId !== undefined
            ? { orchestrationSchemeId: data.orchestrationSchemeId }
            : {}),
          ...(data.delegationDisabled !== undefined
            ? { delegationDisabled: data.delegationDisabled }
            : {}),
        },
      );
      if (restoredOrchestration) {
        onSessionOrchestrationRestored?.(restoredOrchestration);
      }
      if (!ticketMatches()) return;
      const snapshot = parseSessionContextSnapshot(data.contextSnapshot);
      if (snapshot) {
        dispatch({
          type: 'context-telemetry/snapshot',
          snapshot,
          source: 'hydrate',
          hostInstanceId: started.ticket.hostInstanceId,
        });
      }
      if ('lastRequestUsage' in data) {
        dispatch({
          type: 'context-telemetry/last-request',
          sessionId,
          usage: data.lastRequestUsage ?? null,
        });
      }
      if (data.backendCapabilities || data.backendOptions) {
        dispatch({
          type: 'session/backend-hydrated',
          sessionId,
          ...(data.backendCapabilities ? { capabilities: data.backendCapabilities } : {}),
          ...(data.backendOptions ? { options: data.backendOptions } : {}),
        });
      }
      const messages = data.messages ?? [];
      if (messages.length === 0 && data.transcriptPage === undefined) {
        const listed = await hostClient.request({
          type: 'session/messages',
          sessionId,
        });
        if (!ticketMatches()) return;
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
            ...(data.pauseCheckpoint ? { pauseCheckpoint: data.pauseCheckpoint } : {}),
          });
          await hydrateQueuedTurns(sessionId, ticketMatches);
          return;
        }
      }
      if (!ticketMatches()) return;
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
        ...(data.pauseCheckpoint ? { pauseCheckpoint: data.pauseCheckpoint } : {}),
      });
      await hydrateQueuedTurns(sessionId, ticketMatches);
    },
    [
      dispatch,
      dispatchNotification,
      hydrateQueuedTurns,
      hostClient,
      hydrateSessions,
      locale,
      onSessionComposerProfileRestored,
      onSessionOrchestrationRestored,
      resolveSessionScopeHint,
      showArchivedSessions,
      state.activeScope,
      state.activeSessionId,
      state.awaitingTranscript,
      state.generalSessions,
      state.projectSessionsByPath,
      state.sessionEntitiesById,
      state.sessions,
      state.transcriptOwnerSessionId,
      syncHostInstance,
    ],
  );

  resumeSessionRef.current = handleResumeSession;

  const confirmColdRestore = useCallback(
    async (packPath?: string): Promise<void> => {
      if (!coldRestorePrompt) {
        return;
      }
      const sessionId = coldRestorePrompt.sessionId;
      const resolvedPackPath =
        packPath ??
        (coldRestorePrompt.storage.state === 'missing-pack'
          ? ((await chooseSessionPackPath('Choose session pack')) ?? undefined)
          : coldRestorePrompt.storage.packPath);
      if (coldRestorePrompt.storage.state === 'missing-pack' && !resolvedPackPath) {
        return;
      }
      const response = await hostClient.request({
        type: 'session/cold-storage-restore',
        sessionId,
        ...(resolvedPackPath ? { packPath: resolvedPackPath } : {}),
      });
      if (!response.success) {
        dispatchNotification(pushError(response.error));
        return;
      }
      const existing =
        state.sessions.find((item) => item.id === sessionId) ??
        state.generalSessions.find((item) => item.id === sessionId);
      if (existing) {
        const next = { ...existing };
        delete next.storage;
        dispatch({ type: 'session/update', session: next });
      }
      setColdRestorePrompt(null);
      await handleResumeSession(sessionId, { refresh: true });
    },
    [
      coldRestorePrompt,
      dispatch,
      dispatchNotification,
      handleResumeSession,
      hostClient,
      state.generalSessions,
      state.sessions,
    ],
  );

  const handleNewSession = useCallback(
    async (_options?: {
      scope?: { kind: 'general' } | { kind: 'project'; projectPath: string };
    }): Promise<void> => {
      bumpToDraft();
      dispatch({ type: 'session/clear-active' });
    },
    [bumpToDraft, dispatch],
  );

  return {
    handleResumeSession,
    handleNewSession,
    confirmColdRestore,
    coldRestorePrompt,
    clearColdRestorePrompt: () => setColdRestorePrompt(null),
    setColdRestorePrompt,
    bumpToDraft,
    beginNavigation,
    navigationEpochMatches,
    selectionGuardRef,
  };
}


