/** Project activation and session selection share one navigation epoch. */
import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { SessionScope, SessionSummary } from '@piwin/contracts';
import type { HostClient } from '../host-client.js';
import type { ChatUiAction } from '../chat-reducer.js';
import { pushError, type NotificationAction } from '../notification-queue.js';
import { activateProjectOnHost } from '../remote-session-hydrate.js';
import { isNoRepoProjectPath } from '../file-browse-root.js';

type ProjectOpenArgs = {
  hostClient: HostClient;
  dispatch: Dispatch<ChatUiAction>;
  dispatchNotification: Dispatch<NotificationAction>;
  setProjectPickerOpen: Dispatch<SetStateAction<boolean>>;
  generalWorkspacePath?: string | null | undefined;
  showArchivedSessions: boolean;
  beginNavigation: (sessionId: string | null) => number;
  navigationEpochMatches: (epoch: number) => boolean;
  hydrateSessions: (
    scope: string | SessionScope,
    options?: { includeArchived?: boolean },
  ) => Promise<SessionSummary[]>;
  handleResumeSession: (
    sessionId: string,
    context?: { scope?: SessionScope; projectAlreadyActivated?: boolean; quiet?: boolean },
  ) => Promise<void>;
  ensureSession: (input: {
    projectPath: string;
    alreadyTrusted: boolean;
  }) => Promise<string | null>;
};

export function useProjectOpen(args: ProjectOpenArgs) {
  const {
    hostClient,
    dispatch,
    dispatchNotification,
    setProjectPickerOpen,
    generalWorkspacePath,
    showArchivedSessions,
    beginNavigation,
    navigationEpochMatches,
    hydrateSessions,
    handleResumeSession,
    ensureSession,
  } = args;
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
      if (resumeSessionId) {
        // Keep the destination selected throughout activation and list hydration.
        dispatch({ type: 'session/set', sessionId: resumeSessionId, awaitTranscript: true });
      }
      const workspacePath = generalWorkspacePath?.trim() ?? '';
      if (isNoRepoProjectPath(path, workspacePath)) {
        if (!navigationEpochMatches(navigationEpoch)) {
          return;
        }
        dispatch({
          type: 'project/set',
          path: workspacePath,
          trusted: true,
          keepActiveSession: Boolean(resumeSessionId),
        });
        setProjectPickerOpen(false);
        // Draft UI must not wait on the workspace session list.
        void hydrateSessions(workspacePath);
        void hydrateSessions({ kind: 'general' }, { includeArchived: showArchivedSessions });
        if (resumeSessionId) {
          await handleResumeSession(resumeSessionId, {
            scope: { kind: 'project', projectPath: workspacePath },
            projectAlreadyActivated: true,
            ...(options?.quiet === true ? { quiet: true } : {}),
          });
        }
        return;
      }
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
        if (resumeSessionId) {
          dispatch({ type: 'session/load-messages', sessionId: resumeSessionId, messages: [] });
        }
        return;
      }
      if (!activation.trusted) {
        dispatch({
          type: 'project/set',
          path: activation.path,
          trusted: false,
          keepActiveSession: Boolean(resumeSessionId),
        });
        setProjectPickerOpen(false);
        dispatchNotification(
          pushError(
            'This project is not trusted on the Host yet. Trust it on the machine running the Host.',
          ),
        );
        if (resumeSessionId) {
          dispatch({ type: 'session/load-messages', sessionId: resumeSessionId, messages: [] });
        }
        return;
      }
      const openedPath = activation.path;
      dispatch({
        type: 'project/set',
        path: openedPath,
        trusted: true,
        keepActiveSession: Boolean(resumeSessionId),
      });
      setProjectPickerOpen(false);
      // Hydrate sessions for opened project. Do not force-switch session when simply opening/expanding a folder.
      const sessionsRequest = hydrateSessions(openedPath);
      // Also hydrate general sessions in the background so the Conversations
      // sidebar section stays populated while a project is active.
      void hydrateSessions({ kind: 'general' }, { includeArchived: showArchivedSessions });
      if (resumeSessionId) {
        void sessionsRequest.catch((error: unknown) =>
          console.warn('project session list failed', error),
        );
        await handleResumeSession(resumeSessionId, {
          scope: { kind: 'project', projectPath: openedPath },
          projectAlreadyActivated: true,
          ...(options?.quiet === true ? { quiet: true } : {}),
        });
      } else if (options?.switchSession) {
        const sessions = await sessionsRequest;
        if (!navigationEpochMatches(navigationEpoch)) return;
        if (sessions[0]) {
          await handleResumeSession(sessions[0].id, {
            scope: { kind: 'project', projectPath: openedPath },
            projectAlreadyActivated: true,
          });
        } else {
          await ensureSession({ projectPath: openedPath, alreadyTrusted: true });
        }
      } else {
        await sessionsRequest;
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
      generalWorkspacePath,
    ],
  );

  return handleOpenProject;
}
