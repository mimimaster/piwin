/**
 * Workbench owners: host runtime, session hydrate/restore, composer, and
 * view gestures. Must not list hydrateSessions in cold-start effect deps.
 */
import { useRef, type Dispatch, type SetStateAction } from 'react';
import type { ThemeManifest } from '@piwin/contracts';
import type { HostLogEntry } from '../HostLogPanel';
import { useArtifactCanvasAutoReveal } from './use-artifact-canvas-auto-reveal';
import { useDocComments } from './use-doc-comments';
import { useDesktopContextMenuValue } from './use-desktop-context-menu-value';
import { useWorkbenchCommands } from './use-workbench-commands';
import { useWorkbenchComposerRuntime } from './use-workbench-composer-runtime';
import { useWorkbenchComposerSurface } from './use-workbench-composer-surface';
import { useWorkbenchDerivedView } from './use-workbench-derived-view';
import { useWorkbenchHostRuntime } from './use-workbench-host-runtime';
import { useWorkbenchSessionGestures } from './use-workbench-session-gestures';
import { useWorkbenchSessionRuntime } from './use-workbench-session-runtime';
import { useWorkbenchSubagentInspector } from './use-workbench-subagent-inspector';
import { useWorkbenchTurnActions } from './use-workbench-turn-actions';
import type { ChatUiAction, ChatUiState } from '../chat-reducer';
import type { WorkbenchShellChrome } from './use-workbench-shell-chrome';
import type { HostClient } from '../host-client';

export type UseWorkbenchAppModelArgs = {
  hostClient: HostClient;
  state: ChatUiState;
  dispatch: Dispatch<ChatUiAction>;
  chrome: WorkbenchShellChrome;
  activeTheme: ThemeManifest;
  onThemeApplied: (theme: ThemeManifest) => void;
  setHostLogEntries: Dispatch<SetStateAction<HostLogEntry[]>>;
  liveSessionId: string | null;
};

export function useWorkbenchAppModel(args: UseWorkbenchAppModelArgs) {
  const {
    hostClient,
    state,
    dispatch,
    chrome,
    activeTheme,
    onThemeApplied,
    setHostLogEntries,
    liveSessionId,
  } = args;
  const leaveActiveSessionRef = useRef<() => void>(() => undefined);
  const host = useWorkbenchHostRuntime({
    hostClient,
    state,
    dispatch,
    chrome,
    activeTheme,
    onThemeApplied,
    setHostLogEntries,
    onActiveSessionCleared: () => leaveActiveSessionRef.current(),
  });
  const session = useWorkbenchSessionRuntime({
    hostClient,
    state,
    dispatch,
    chrome,
    host,
    setHostLogEntries,
  });
  leaveActiveSessionRef.current = session.bumpToDraft;
  const composer = useWorkbenchComposerRuntime({
    hostClient,
    state,
    dispatch,
    chrome,
    host,
    session,
  });
  const {
    handleOpenDocument,
    handleOpenDiff,
    handleOpenArtifactCanvas,
    handleStartNewSession,
    handleResumeDraft,
    handleRetryMessage,
    handleCommentLine,
    handleExtensionUiResolve,
    handleExtensionUiAbort,
  } = useWorkbenchSessionGestures({
    hostClient,
    state,
    dispatch,
    inspectorFileDiff: host.inspectorFileDiff,
    openDocumentBase: host.openDocumentBase,
    revealDocPreview: chrome.revealDocPreview,
    artifactCanvas: host.artifactCanvas,
    layoutMode: chrome.layoutMode,
    rightPanelWidthPx: chrome.rightPanelResize.widthPx,
    setRightPanelWidthPx: chrome.rightPanelResize.setWidthPx,
    openInspector: chrome.shell.openInspector,
    startNewDraft: composer.startNewDraft,
    handleNewSession: session.handleNewSession,
    draftSessions: composer.draftSessions,
    handleOpenProject: session.handleOpenProject,
    hydrateSessions: session.hydrateSessions,
    resumeDraft: composer.resumeDraft,
    showArchivedSessions: chrome.sessionListChrome.showArchivedSessions,
    setEditingMessageId: chrome.setEditingMessageId,
    extensionUiRequest: host.extensionUiRequest,
    clearExtensionUiRequest: host.clearExtensionUiRequest,
    handleAbort: session.handleAbort,
  });
  // Capability is the only master switch. artifactCodeFirst is Inline-only and
  // must not be folded into `enabled`. Conversation and Project both auto-open
  // the right Canvas as soon as `surface="canvas"` is parseable.
  useArtifactCanvasAutoReveal({
    activeSessionId: state.activeSessionId,
    messages: state.messages,
    enabled: host.config?.artifact?.enabled ?? true,
    runTerminalKind: state.runTerminal.kind,
    onReveal: handleOpenArtifactCanvas,
    onUpdate: host.artifactCanvas.openTarget,
    ...(host.config?.artifact?.maxBytes !== undefined
      ? { maxBytes: host.config.artifact.maxBytes }
      : {}),
  });
  const desktopContextMenuValue = useDesktopContextMenuValue({
    projectPath: host.fileBrowseRoot ?? state.projectPath,
    activeSessionId: state.activeSessionId,
    hostReady: state.hostReady,
    locale: chrome.desktopLocale,
    hostClient,
    addContextRef: composer.addContextRef,
    addMediaAttachment: composer.addExistingMediaAttachment,
    dispatchNotification: host.dispatchNotification,
    handleOpenDocument,
    handleRetryMessage,
    requestTruncateAfter: session.requestTruncateAfter,
    handleSend: composer.handleSend,
    handleForkSession: session.handleForkSession,
    setComposer: composer.setComposer,
    openInspector: chrome.shell.openInspector,
  });
  const comments = useDocComments({
    activeDocument: host.activeDocument,
    composer: composer.composer,
    send: composer.handleSend,
  });
  const commands = useWorkbenchCommands({
    activeTheme,
    preferences: chrome.preferences,
    setPreferences: chrome.setPreferences,
    desktopLocale: chrome.desktopLocale,
    setDesktopLocale: chrome.setDesktopLocale,
    dispatchNotification: host.dispatchNotification,
    onThemeApplied,
    shell: chrome.shell,
    handleStartNewSession,
    handleOpenWorkspaceClick: session.handleOpenWorkspaceClick,
    handleAbort: session.handleAbort,
    openSessionSearch: chrome.sessionListChrome.openSessionSearch,
  });
  const derived = useWorkbenchDerivedView({
    state,
    sessionPlan: host.sessionPlan,
    jobs: host.jobs,
    desktopLocale: chrome.desktopLocale,
    runClock: chrome.runClock,
    selectedModelContextWindow: composer.selectedModelContextWindow,
  });
  const composerSurface = useWorkbenchComposerSurface({
    hostClient,
    state,
    chrome,
    host,
    session,
    composer,
    activeCommentsCount: comments.activeComments.length,
    activeDocumentTitle: host.activeDocument?.title,
    onRemoveDocComments: comments.clearDocComments,
    onSendWithComments: comments.sendWithComments,
    handleExtensionUiResolve,
    handleExtensionUiAbort,
    openSettingsSection: commands.openSettingsSection,
    liveSessionId,
  });
  const subagent = useWorkbenchSubagentInspector({
    hostClient,
    state,
    dispatch,
    dispatchNotification: host.dispatchNotification,
    desktopLocale: chrome.desktopLocale,
    modelOptions: host.modelOptions,
    preferences: chrome.preferences,
    config: host.config,
    requestGit: host.requestGit,
    handleResumeSession: session.handleResumeSession,
    handleOpenDocument,
    handleOpenDiff,
    handleArtifactAction: host.handleArtifactAction,
    handleOpenArtifactCanvas,
  });
  const turn = useWorkbenchTurnActions({
    hostClient,
    state,
    sessionPlan: host.sessionPlan,
    dispatch,
    dispatchNotification: host.dispatchNotification,
    setEditingMessageId: chrome.setEditingMessageId,
    branchResend: session.branchResend,
    retryTurn: session.retryTurn,
  });

  return {
    ...host,
    ...session,
    ...composer,
    handleOpenDocument,
    handleOpenDiff,
    handleOpenArtifactCanvas,
    handleStartNewSession,
    handleResumeDraft,
    handleRetryMessage,
    handleCommentLine,
    handleExtensionUiResolve,
    handleExtensionUiAbort,
    desktopContextMenuValue,
    activeComments: comments.activeComments,
    handleAddDocComment: comments.addDocComment,
    handleEditDocComment: comments.editDocComment,
    handleDeleteDocComment: comments.deleteDocComment,
    handleRemoveDocComments: comments.clearDocComments,
    handleSendWithComments: comments.sendWithComments,
    ...commands,
    ...derived,
    ...composerSurface,
    ...subagent,
    ...turn,
  };
}
