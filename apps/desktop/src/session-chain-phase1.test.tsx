// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { saveSidebarMode } from './sidebar-mode';
import {
  chatUiReducer,
  createInitialChatUiState,
  type ChatUiState,
} from './chat-reducer';
import type { HostClient } from './host-client';
import { useComposerMedia } from './hooks/use-composer-media';
import { createInitialTestChatUiState } from './hooks/composer-media-test-harness';
import { useWorkbenchSessionGestures } from './hooks/use-workbench-session-gestures';
import { WorkbenchSidebar, type WorkbenchSidebarProps } from './workbench-sidebar';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function stubHostClient(): HostClient {
  return {
    getTransport: () => 'local',
    supportsCommand: () => true,
    getHostInstanceId: () => 'host-1',
    request: vi.fn(),
  } as unknown as HostClient;
}

function sidebarHarnessProps(
  overrides: Partial<WorkbenchSidebarProps> = {},
): WorkbenchSidebarProps {
  return {
    state: {
      ...createInitialChatUiState(),
      hostReady: true,
      activeScope: { kind: 'general' as const },
    },
    hostClient: stubHostClient(),
    hostStatus: null,
    recentProjects: [],
    filteredSessions: [],
    filteredGeneralSessions: [],
    sessionGroups: [],
    sessionListOrder: 'updated',
    onSessionListOrderChange: () => {},
    sessionSearch: '',
    onOpenSessionSearch: () => {},
    showArchivedSessions: false,
    setShowArchivedSessions: () => {},
    hydrateSessions: async () => [],
    settingsOpen: false,
    onOpenWorkspace: () => {},
    onOpenProject: () => {},
    onRemoveProject: () => {},
    onNewSession: () => {},
    onResumeSession: () => {},
    onResumeDraft: async () => {},
    draftSessions: [],
    activeDraftId: null,
    sessionMenu: null,
    onOpenSessionMenu: () => {},
    onSessionMenuAction: () => {},
    onRequestDeleteSession: () => {},
    openSettingsSection: () => {},
    dispatch: () => {},
    isOverlayPresentation: false,
    locale: 'en',
    sidebarResize: {
      widthPx: 260,
      isResizing: false,
      onResizePointerDown: () => {},
      setWidthPx: () => {},
    },
    backendServiceSessionIds: {},
    shell: { closeOverlay: () => {} },
    sidebarMode: 'chat',
    onSidebarModeChange: () => {},
    ...overrides,
  };
}

describe('session chain phase 1', () => {
  // The project row and its "+" live in the sidebar's project pane.
  beforeEach(() => {
    saveSidebarMode('code');
  });

  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  it('keeps the chat pane when Conversations + starts a general session', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const onSidebarModeChange = vi.fn();
    const onNewSession = vi.fn();
    const dispatch = vi.fn();

    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <WorkbenchSidebar
            {...sidebarHarnessProps({
              onSidebarModeChange,
              onNewSession,
              dispatch,
              sidebarMode: 'chat',
            })}
          />
        </PiwinUiProvider>,
      );
    });

    const plus = container.querySelector<HTMLButtonElement>(
      '[data-testid="general-workspace-btn"]',
    );
    expect(plus).not.toBeNull();
    await act(async () => {
      plus?.click();
    });

    expect(onSidebarModeChange).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith({ type: 'project/clear' });
    expect(onNewSession).toHaveBeenCalledWith({ scope: { kind: 'general' } });
  });

  it('WorkbenchSidebar forwards the project + scope instead of dropping it', () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const onNewSession = vi.fn();
    const onOpenProject = vi.fn();
    const state = {
      ...createInitialChatUiState(),
      hostReady: true,
      activeScope: { kind: 'general' as const },
    };
    const props: WorkbenchSidebarProps = {
      state,
      hostClient: stubHostClient(),
      hostStatus: null,
      recentProjects: [
        {
          path: '/Users/test/project-a',
          displayName: 'project-a',
          trust: 'trusted',
          lastOpenedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      ],
      filteredSessions: [],
      filteredGeneralSessions: [],
      sessionGroups: [],
      sessionListOrder: 'updated',
      onSessionListOrderChange: () => {},
      sessionSearch: '',
      onOpenSessionSearch: () => {},
      showArchivedSessions: false,
      setShowArchivedSessions: () => {},
      hydrateSessions: async () => [],
      settingsOpen: false,
      onOpenWorkspace: () => {},
      onOpenProject,
      onRemoveProject: () => {},
      onNewSession,
      onResumeSession: () => {},
      onResumeDraft: async () => {},
      draftSessions: [],
      activeDraftId: null,
      sessionMenu: null,
      onOpenSessionMenu: () => {},
      onSessionMenuAction: () => {},
      onRequestDeleteSession: () => {},
      openSettingsSection: () => {},
      dispatch: () => {},
      isOverlayPresentation: false,
      locale: 'en',
      sidebarResize: {
        widthPx: 260,
        isResizing: false,
        onResizePointerDown: () => {},
        setWidthPx: () => {},
      },
      backendServiceSessionIds: {},
      shell: { closeOverlay: () => {} },
      sidebarMode: 'code',
      onSidebarModeChange: () => {},
    };

    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <WorkbenchSidebar {...props} />
        </PiwinUiProvider>,
      );
    });

    act(() => {
      const projectRow = container?.querySelector(
        '[data-testid="repository-item"][data-project-path="/Users/test/project-a"]',
      );
      projectRow
        ?.closest('.tree-folder-summary')
        ?.querySelector<HTMLButtonElement>('.tree-folder-add-btn')
        ?.click();
    });

    // Row + only names the project; opening happens inside start-new-session.
    expect(onOpenProject).not.toHaveBeenCalled();
    expect(onNewSession).toHaveBeenCalledWith({
      scope: { kind: 'project', projectPath: '/Users/test/project-a' },
    });
  });

  it('opens the project before starting a draft when New is scoped to another project', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const handleOpenProject = vi.fn(async () => undefined);
    const startNewDraft = vi.fn();
    const handleNewSession = vi.fn(async () => undefined);
    const callOrder: string[] = [];
    handleOpenProject.mockImplementation(async () => {
      callOrder.push('open');
    });
    startNewDraft.mockImplementation(() => {
      callOrder.push('draft');
    });
    handleNewSession.mockImplementation(async () => {
      callOrder.push('new');
    });

    let captured: ReturnType<typeof useWorkbenchSessionGestures> | undefined;
    function Harness(): null {
      captured = useWorkbenchSessionGestures({
        hostClient: stubHostClient(),
        state: createInitialChatUiState(),
        dispatch: vi.fn(),
        inspectorFileDiff: { clear: vi.fn(), open: vi.fn() },
        openDocumentBase: vi.fn(),
        revealDocPreview: vi.fn(),
        artifactCanvas: { openTarget: vi.fn() },
        layoutMode: 'desktop',
        rightPanelWidthPx: 360,
        setRightPanelWidthPx: vi.fn(),
        openInspector: vi.fn(),
        startNewDraft,
        handleNewSession,
        draftSessions: [],
        handleOpenProject,
        hydrateSessions: async () => [],
        resumeDraft: vi.fn(),
        showArchivedSessions: false,
        setEditingMessageId: vi.fn(),
        extensionUiRequest: null,
        clearExtensionUiRequest: vi.fn(),
        handleAbort: async () => undefined,
      });
      return null;
    }

    act(() => {
      root?.render(<Harness />);
    });
    await act(async () => {
      await captured?.handleStartNewSession({
        scope: { kind: 'project', projectPath: '/Users/test/project-a' },
      });
    });

    expect(handleOpenProject).toHaveBeenCalledWith('/Users/test/project-a');
    expect(startNewDraft).toHaveBeenCalledWith({
      kind: 'project',
      projectPath: '/Users/test/project-a',
    });
    expect(handleNewSession).toHaveBeenCalledWith({
      scope: { kind: 'project', projectPath: '/Users/test/project-a' },
    });
    expect(callOrder).toEqual(['open', 'draft', 'new']);
  });

  it('skips re-opening when New is already in that project', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const handleOpenProject = vi.fn(async () => undefined);
    const startNewDraft = vi.fn();
    const handleNewSession = vi.fn(async () => undefined);
    const projectPath = '/Users/test/project-a';

    let captured: ReturnType<typeof useWorkbenchSessionGestures> | undefined;
    function Harness(): null {
      captured = useWorkbenchSessionGestures({
        hostClient: stubHostClient(),
        state: {
          ...createInitialChatUiState(),
          activeScope: { kind: 'project', projectPath },
          projectPath,
          projectTrusted: true,
        },
        dispatch: vi.fn(),
        inspectorFileDiff: { clear: vi.fn(), open: vi.fn() },
        openDocumentBase: vi.fn(),
        revealDocPreview: vi.fn(),
        artifactCanvas: { openTarget: vi.fn() },
        layoutMode: 'desktop',
        rightPanelWidthPx: 360,
        setRightPanelWidthPx: vi.fn(),
        openInspector: vi.fn(),
        startNewDraft,
        handleNewSession,
        draftSessions: [],
        handleOpenProject,
        hydrateSessions: async () => [],
        resumeDraft: vi.fn(),
        showArchivedSessions: false,
        setEditingMessageId: vi.fn(),
        extensionUiRequest: null,
        clearExtensionUiRequest: vi.fn(),
        handleAbort: async () => undefined,
      });
      return null;
    }

    act(() => {
      root?.render(<Harness />);
    });
    await act(async () => {
      await captured?.handleStartNewSession({
        scope: { kind: 'project', projectPath },
      });
    });

    expect(handleOpenProject).not.toHaveBeenCalled();
    expect(startNewDraft).toHaveBeenCalledWith({ kind: 'project', projectPath });
    expect(handleNewSession).toHaveBeenCalled();
  });

  it('keeps an explicit project draft scope while navigation is still General', () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    let captured: ReturnType<typeof useComposerMedia> | undefined;
    function Harness(props: { state: ChatUiState }): null {
      captured = useComposerMedia({
        hostClient: stubHostClient(),
        state: props.state,
        dispatch: vi.fn(),
        agentMode: 'agent',
      });
      return null;
    }
    const general = createInitialTestChatUiState();
    act(() => root?.render(<Harness state={general} />));
    act(() => {
      captured?.startNewDraft({ kind: 'project', projectPath: '/tmp/p' });
    });
    act(() => root?.render(<Harness state={general} />));
    act(() => captured?.setComposer('hello from P'));
    expect(captured?.draftSessions[0]?.scope).toEqual({
      kind: 'project',
      projectPath: '/tmp/p',
    });
  });

  it('does not restore a failed send from A onto B’s composer', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    let settlePrompt: ((value: { type: 'response'; command: string; success: false; error: string }) => void)
      | undefined;
    const hostClient = {
      request: vi.fn((command: { type: string }) => {
        if (command.type === 'session/prompt') {
          return new Promise((resolve) => {
            settlePrompt = resolve;
          });
        }
        return Promise.resolve({ type: 'response', command: command.type, success: true, data: {} });
      }),
    } as unknown as HostClient;
    let captured: ReturnType<typeof useComposerMedia> | undefined;
    function Harness(props: { state: ChatUiState }): null {
      captured = useComposerMedia({
        hostClient,
        state: props.state,
        dispatch: vi.fn(),
        agentMode: 'agent',
      });
      return null;
    }
    const sessionA = { ...createInitialTestChatUiState(), activeSessionId: 'session-a' };
    const sessionB = { ...createInitialTestChatUiState(), activeSessionId: 'session-b' };
    act(() => root?.render(<Harness state={sessionA} />));
    act(() => captured?.setComposer('from A'));
    const sending = captured?.handleSend() ?? Promise.resolve();
    await act(async () => {
      await Promise.resolve();
    });
    act(() => root?.render(<Harness state={sessionB} />));
    act(() => captured?.setComposer('from B'));
    expect(typeof settlePrompt).toBe('function');
    settlePrompt?.({
      type: 'response',
      command: 'session/prompt',
      success: false,
      error: 'rejected',
    });
    await act(async () => {
      await sending;
    });
    expect(captured?.composer).toBe('from B');
  });

  it('run/accepted for another session does not start the current view’s run', () => {
    let state = chatUiReducer(createInitialChatUiState(), {
      type: 'session/set',
      sessionId: 'session-b',
    });
    state = chatUiReducer(state, {
      type: 'run/accepted',
      runId: 'run-a',
      sessionId: 'session-a',
    });
    expect(state.activeSessionId).toBe('session-b');
    expect(state.streaming).toBe(false);
    expect(state.activeRunId).toBeNull();
    expect(state.workingSessionIds['session-a']).toBe(true);
  });

  it('session/set ifIdle does not steal an already selected session', () => {
    let state = chatUiReducer(createInitialChatUiState(), {
      type: 'session/set',
      sessionId: 'session-b',
    });
    state = chatUiReducer(state, {
      type: 'session/set',
      sessionId: 'session-a',
      ifIdle: true,
    });
    expect(state.activeSessionId).toBe('session-b');
  });
});
