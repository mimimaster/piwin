import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactElement,
  type ReactNode,
} from 'react';
import { showUiNotification } from '@piwin/ui-kit';
import { selectAttentionSessionIds } from '../attention-badge-model';
import { AttentionOptInBanner } from '../attention-opt-in-banner';
import { shouldShowAttentionOptIn } from '../attention-opt-in-policy';
import {
  ATTENTION_OPT_IN_DISMISSED_KEY,
  readAttentionPreferences,
  subscribeAttentionPreferences,
} from '../attention-preferences';
import {
  lookupAttentionSession,
  type AttentionLookupSession,
} from '../attention-session-lookup';
import type { ChatUiAction, ChatUiState } from '../chat-reducer';
import {
  createDesktopAttentionController,
  type DesktopAttentionSnapshot,
  type InAppAttentionNotice,
} from '../desktop-attention-controller';
import {
  createDesktopAttentionOs,
  type AttentionAuthorization,
  type DesktopAttentionOs,
} from '../desktop-attention-os';
import type { DesktopLocale } from '../desktop-locale';
import type { HostClient } from '../host-client';
import { projectLabel } from '../project-display-name';
import type { ConversationPaneLayoutController } from '../use-conversation-pane-layout';
import { getWindowPresence, subscribeWindowPresence } from '../window-focus-signal';
import { useAttentionActivation } from './use-attention-activation';
import { selectVisibleSessionIds } from '../workbench/docking/visible-sessions';
import type { DockingWorkspaceController } from '../workbench/docking/use-docking-workspace';

export type DesktopAttentionArgs = {
  hostClient: HostClient;
  state: ChatUiState;
  dispatch: Dispatch<ChatUiAction>;
  locale: DesktopLocale;
  hostStatus?: { ready?: boolean } | null;
  extensionUiRequest?: { sessionId: string } | null;
  isOverlayPresentation: boolean;
  activeSubPage: string | null | undefined;
  dockingEnabled: boolean;
  dockingWorkspace: Pick<DockingWorkspaceController, 'state'>;
  conversationPanesEnabled: boolean;
  conversationPaneController: Pick<ConversationPaneLayoutController, 'layout'>;
  openSessionFromShell: (sessionId: string) => void | Promise<void>;
  recentProjects?: readonly { path: string; displayName?: string }[];
  children?: ReactNode;
};

function sessionProjectPath(session: AttentionLookupSession, state: ChatUiState): string | null {
  if (typeof session.projectPath === 'string' && session.projectPath !== '') {
    return session.projectPath;
  }
  if (session.scope?.kind === 'project') {
    return session.scope.projectPath;
  }
  if (state.activeScope.kind === 'project') {
    return state.activeScope.projectPath;
  }
  return state.projectPath;
}

function describeSessionForAttention(
  sessionId: string,
  state: ChatUiState,
  projects: readonly { path: string; displayName?: string }[],
): ReturnType<DesktopAttentionSnapshot['describeSession']> {
  const session = lookupAttentionSession(state, sessionId);
  if (!session) {
    return {};
  }
  const projectPath = sessionProjectPath(session, state);
  const projectId =
    typeof session.projectId === 'string' && session.projectId !== ''
      ? session.projectId
      : projectPath ?? 'general';
  return {
    sessionTitle: session.title ?? session.name,
    ...(projectPath ? { projectName: projectLabel(projectPath, projects) } : {}),
    projectId,
  };
}

function readOptInDismissedAt(storage: Pick<Storage, 'getItem'>): number | null {
  try {
    const raw = storage.getItem(ATTENTION_OPT_IN_DISMISSED_KEY);
    if (raw == null || raw === '') {
      return null;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function resolveHostReady(
  hostClient: Pick<HostClient, 'isReady'>,
  hostStatus: { ready?: boolean } | null | undefined,
  fallback: boolean,
): boolean {
  if (typeof hostClient.isReady === 'function') {
    return hostClient.isReady();
  }
  if (hostStatus?.ready === true) {
    return true;
  }
  return fallback;
}

function toPresence(focused: boolean, documentVisible: boolean): 'active' | 'inactive' {
  return focused && documentVisible ? 'active' : 'inactive';
}

function visibleKey(sessionIds: readonly string[], conversationCovered: boolean): string {
  return `${conversationCovered ? '1' : '0'}:${sessionIds.join(',')}`;
}

export function useDesktopAttention(args: DesktopAttentionArgs): ReactElement | null {
  const {
    hostClient,
    state,
    dispatch,
    locale,
    hostStatus,
    extensionUiRequest,
    isOverlayPresentation,
    activeSubPage,
    dockingEnabled,
    dockingWorkspace,
    conversationPanesEnabled,
    conversationPaneController,
    openSessionFromShell,
    recentProjects = [],
  } = args;

  const osRef = useRef<DesktopAttentionOs | null>(null);
  if (osRef.current === null) {
    osRef.current = createDesktopAttentionOs();
  }
  const os = osRef.current;
  const controllerRef = useRef<ReturnType<typeof createDesktopAttentionController> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const hostStatusRef = useRef(hostStatus);
  hostStatusRef.current = hostStatus;
  const hostClientRef = useRef(hostClient);
  hostClientRef.current = hostClient;
  const projectsRef = useRef(recentProjects);
  projectsRef.current = recentProjects;
  const openSessionRef = useRef(openSessionFromShell);
  openSessionRef.current = openSessionFromShell;
  const handleActivation = useAttentionActivation({
    state,
    locale,
    openSession: openSessionFromShell,
  });
  const preferencesRef = useRef(readAttentionPreferences());
  const conversationCovered = Boolean(activeSubPage) || isOverlayPresentation;
  const visibleSessionIds = selectVisibleSessionIds({
    dockingState: dockingEnabled ? dockingWorkspace.state : null,
    paneLayout:
      conversationPanesEnabled && !dockingEnabled ? conversationPaneController.layout : null,
    activeSessionId: state.activeSessionId,
    conversationCovered,
  });
  const windowPresence = getWindowPresence();
  const snapshotRef = useRef({
    presence: toPresence(windowPresence.focused, windowPresence.documentVisible),
    visibleSessionIds,
    conversationCovered,
    activeSessionId: state.activeSessionId,
  });
  snapshotRef.current = {
    presence: snapshotRef.current.presence,
    visibleSessionIds,
    conversationCovered,
    activeSessionId: state.activeSessionId,
  };

  const [authorization, setAuthorization] = useState<AttentionAuthorization>('not-determined');
  const [hasSentThisLaunch, setHasSentThisLaunch] = useState(false);
  const [dismissedAt, setDismissedAt] = useState<number | null>(() =>
    readOptInDismissedAt(localStorage),
  );
  const [, setPreferencesEpoch] = useState(0);

  useEffect(() => {
    if (state.activeRunId != null || Object.keys(state.workingSessionIds).length > 0) {
      setHasSentThisLaunch(true);
    }
  }, [state.activeRunId, state.workingSessionIds]);

  useEffect(() => {
    return subscribeAttentionPreferences((next) => {
      preferencesRef.current = next;
      setPreferencesEpoch((epoch) => epoch + 1);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void os.getAuthorization().then((value) => {
      if (!cancelled) {
        setAuthorization(value);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [os]);

  useEffect(() => {
    const readSnapshot = (): DesktopAttentionSnapshot => {
      const current = snapshotRef.current;
      const snapshot = {
        presence: current.presence,
        visibleSessionIds: new Set(current.visibleSessionIds),
        activeSessionId: current.activeSessionId,
        conversationCovered: current.conversationCovered,
        preferences: preferencesRef.current,
        locale: localeRef.current,
        hostReady: resolveHostReady(
          hostClientRef.current,
          hostStatusRef.current,
          stateRef.current.hostReady,
        ),
        describeSession: (sessionId: string) =>
          describeSessionForAttention(sessionId, stateRef.current, projectsRef.current),
      };
      return snapshot;
    };
    const showInAppNotice = (notice: InAppAttentionNotice): void => {
      showUiNotification({
        tone: notice.tone ?? 'info',
        message: notice.body,
        ...(notice.title !== undefined ? { title: notice.title } : {}),
        ...(notice.action
          ? {
              action: {
                label: notice.action.label,
                onClick: () => {
                  const sessionId = notice.action?.sessionId;
                  if (sessionId === undefined) {
                    return;
                  }
                  void openSessionRef.current(sessionId);
                },
              },
            }
          : {}),
      });
    };
    const controller = createDesktopAttentionController({
      hostClient,
      os,
      storage: localStorage,
      now: Date.now,
      setTimer: (callback, ms) => {
        const t = window.setTimeout(callback, ms);
        return () => window.clearTimeout(t);
      },
      getSnapshot: readSnapshot,
      showInAppNotice,
    });
    controllerRef.current = controller;
    const applyPresence = (focused: boolean, documentVisible: boolean): void => {
      const presence = toPresence(focused, documentVisible);
      snapshotRef.current = { ...snapshotRef.current, presence };
      dispatch({ type: 'attention/presence', presence });
      controller.onPresenceChanged(presence);
    };
    const initial = getWindowPresence();
    applyPresence(initial.focused, initial.documentVisible);
    const unsubscribePresence = subscribeWindowPresence((presence) => {
      applyPresence(presence.focused, presence.documentVisible);
    });
    let cancelled = false;
    void os.takePendingActivation().then((pending) => {
      if (cancelled || pending === null) {
        return;
      }
      handleActivation(pending);
    });
    const unsubscribeActivation = os.subscribeActivation((activation) => {
      if (!cancelled) {
        handleActivation(activation);
        // Native keeps a pending copy of every click for cold launch; drain it
        // so a later remount of this effect does not replay the same click.
        void os.takePendingActivation();
      }
    });
    return () => {
      cancelled = true;
      unsubscribePresence();
      unsubscribeActivation();
      controller.dispose();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [dispatch, handleActivation, hostClient, os]);

  const sessionsKey = visibleKey(visibleSessionIds, conversationCovered);
  useEffect(() => {
    dispatch({
      type: 'attention/visible-sessions',
      sessionIds: visibleSessionIds,
      conversationCovered,
    });
  }, [conversationCovered, dispatch, sessionsKey, visibleSessionIds]);

  const attentionSessionIds = selectAttentionSessionIds({
    completedAttentionSessionIds: state.completedAttentionSessionIds,
    failedAttentionSessionIds: state.failedAttentionSessionIds,
    permissionQueue: state.permissionQueue,
    questionSessionId: extensionUiRequest?.sessionId ?? null,
  });
  const attentionKey = attentionSessionIds.join(',');
  useEffect(() => {
    controllerRef.current?.syncAttentionSessions(attentionSessionIds);
  }, [attentionKey, attentionSessionIds]);

  const showOptIn = shouldShowAttentionOptIn({
    authorization,
    hasSentThisLaunch,
    dismissedAt,
    now: Date.now(),
  });

  return (
    <AttentionOptInBanner
      visible={showOptIn}
      locale={locale}
      onEnable={() => {
        void os.requestAuthorization().then(setAuthorization);
      }}
      onDismiss={() => {
        const at = Date.now();
        localStorage.setItem(ATTENTION_OPT_IN_DISMISSED_KEY, String(at));
        setDismissedAt(at);
      }}
    />
  );
}

export function DesktopAttentionLayer(props: DesktopAttentionArgs): ReactElement {
  const banner = useDesktopAttention(props);
  return (
    <>
      {banner}
      {props.children}
    </>
  );
}
