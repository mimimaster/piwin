// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import {
  chatUiReducer,
  createInitialChatUiState,
  type ChatUiState,
} from './chat-reducer';
import type { HostClient } from './host-client';
import { useComposerMedia } from './hooks/use-composer-media';
import { createInitialTestChatUiState } from './hooks/composer-media-test-harness';
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

describe('session chain phase 1', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
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
    };

    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <WorkbenchSidebar {...props} />
        </PiwinUiProvider>,
      );
    });

    act(() => {
      (container?.querySelector('.tree-folder-add-btn') as HTMLButtonElement | null)?.click();
    });

    expect(onOpenProject).toHaveBeenCalledWith('/Users/test/project-a');
    expect(onNewSession).toHaveBeenCalledWith({
      scope: { kind: 'project', projectPath: '/Users/test/project-a' },
    });
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
