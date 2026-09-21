// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialChatUiState, type ChatUiState, type SessionListItemUi } from '../chat-reducer';
import { createConversationPaneLayout } from '../conversation-pane-layout';
import type { HostClient } from '../host-client';
import type { DesktopAttentionArgs } from './use-desktop-attention';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const {
  takePendingActivation,
  subscribeActivation,
  getAuthorization,
  requestAuthorization,
  onPresenceChanged,
  createControllerMock,
  getWindowPresenceMock,
  presenceListeners,
  showUiNotification,
} = vi.hoisted(() => {
  const onPresenceChanged = vi.fn();
  const syncAttentionSessions = vi.fn();
  const disposeController = vi.fn();
  const presenceListeners = new Set<
    (snapshot: { focused: boolean; documentVisible: boolean }) => void
  >();
  return {
    takePendingActivation: vi.fn(async () => null as { sessionId: string; attentionKey: string } | null),
    subscribeActivation: vi.fn((listener: (activation: { sessionId: string; attentionKey: string }) => void) => {
      void listener;
      return () => undefined;
    }),
    getAuthorization: vi.fn(async () => 'not-determined' as const),
    requestAuthorization: vi.fn(async () => 'granted' as const),
    onPresenceChanged,
    syncAttentionSessions,
    disposeController,
    createControllerMock: vi.fn(() => ({
      onPresenceChanged,
      syncAttentionSessions,
      dispose: disposeController,
    })),
    getWindowPresenceMock: vi.fn(() => ({ focused: true, documentVisible: true })),
    presenceListeners,
    showUiNotification: vi.fn(),
  };
});

vi.mock('../desktop-attention-controller', () => ({
  createDesktopAttentionController: createControllerMock,
}));

vi.mock('../desktop-attention-os', () => ({
  createDesktopAttentionOs: () => ({
    getCapabilities: async () => ({
      nativeCenter: false,
      clickActivation: false,
      authorizationReliable: false,
    }),
    getAuthorization,
    requestAuthorization,
    deliver: async () => 'unsupported' as const,
    removeDelivered: async () => undefined,
    setBadge: async () => undefined,
    requestAttention: async () => undefined,
    takePendingActivation,
    subscribeActivation,
    openSystemSettings: async () => undefined,
  }),
}));

vi.mock('../window-focus-signal', () => ({
  getWindowPresence: getWindowPresenceMock,
  subscribeWindowPresence: (
    listener: (snapshot: { focused: boolean; documentVisible: boolean }) => void,
  ) => {
    presenceListeners.add(listener);
    return () => {
      presenceListeners.delete(listener);
    };
  },
}));

vi.mock('@piwin/ui-kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@piwin/ui-kit')>();
  return {
    ...actual,
    showUiNotification,
  };
});

import { DesktopAttentionLayer } from './use-desktop-attention';

function sessionItem(
  id: string,
  extra: Partial<SessionListItemUi> & { parentSessionId?: string } = {},
): SessionListItemUi {
  return { id, name: id, ...extra };
}

function baseState(overrides: Partial<ChatUiState> = {}): ChatUiState {
  return {
    ...createInitialChatUiState(),
    sessions: [sessionItem('session-1')],
    activeSessionId: 'session-1',
    ...overrides,
  };
}

function defaultArgs(
  overrides: Partial<DesktopAttentionArgs> = {},
): DesktopAttentionArgs {
  return {
    hostClient: {
      subscribe: vi.fn(() => () => undefined),
      isReady: () => true,
    } as unknown as HostClient,
    state: baseState(),
    dispatch: vi.fn(),
    locale: 'zh-CN',
    hostStatus: { ready: true },
    extensionUiRequest: null,
    isOverlayPresentation: false,
    activeSubPage: null,
    dockingEnabled: false,
    dockingWorkspace: { state: {} as DesktopAttentionArgs['dockingWorkspace']['state'] },
    conversationPanesEnabled: false,
    conversationPaneController: { layout: createConversationPaneLayout() },
    openSessionFromShell: vi.fn(async () => undefined),
    recentProjects: [],
    ...overrides,
  };
}

describe('useDesktopAttention', () => {
  let container: HTMLElement;
  let root: Root;
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    takePendingActivation.mockResolvedValue(null);
    subscribeActivation.mockImplementation(() => () => undefined);
    getWindowPresenceMock.mockReturnValue({ focused: true, documentVisible: true });
    presenceListeners.clear();
    localStorage.clear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    vi.clearAllMocks();
  });

  async function renderLayer(args: DesktopAttentionArgs): Promise<void> {
    const element: ReactElement = <DesktopAttentionLayer {...args} />;
    await act(async () => {
      root.render(element);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('AN-T59 opens the session on activation and notices when it is missing', async () => {
    const openSessionFromShell = vi.fn(async () => undefined);
    const args = defaultArgs({ openSessionFromShell });
    let activationListener: ((activation: { sessionId: string; attentionKey: string }) => void) | null =
      null;
    subscribeActivation.mockImplementation((listener) => {
      activationListener = listener;
      return () => {
        activationListener = null;
      };
    });
    await renderLayer(args);
    expect(activationListener).not.toBeNull();

    await act(async () => {
      activationListener?.({ sessionId: 'session-1', attentionKey: 'complete:run-1' });
    });
    expect(openSessionFromShell).toHaveBeenCalledWith('session-1');
    expect(showUiNotification).not.toHaveBeenCalled();

    openSessionFromShell.mockClear();
    await act(async () => {
      activationListener?.({ sessionId: 'missing', attentionKey: 'complete:run-2' });
    });
    expect(openSessionFromShell).not.toHaveBeenCalled();
    expect(showUiNotification).toHaveBeenCalledWith({
      tone: 'info',
      message: '该会话已不可用',
    });
  });

  it('AN-T59 opens the parent session when the list item has parentSessionId', async () => {
    const openSessionFromShell = vi.fn(async () => undefined);
    let activationListener: ((activation: { sessionId: string; attentionKey: string }) => void) | null =
      null;
    subscribeActivation.mockImplementation((listener) => {
      activationListener = listener;
      return () => {
        activationListener = null;
      };
    });
    await renderLayer(
      defaultArgs({
        openSessionFromShell,
        state: baseState({
          sessions: [sessionItem('child-1', { parentSessionId: 'parent-1' })],
          activeSessionId: 'parent-1',
        }),
      }),
    );
    await act(async () => {
      activationListener?.({ sessionId: 'child-1', attentionKey: 'complete:run-1' });
    });
    expect(openSessionFromShell).toHaveBeenCalledWith('parent-1');
  });

  it('AN-T60 consumes pending activation once on mount', async () => {
    const openSessionFromShell = vi.fn(async () => undefined);
    takePendingActivation.mockResolvedValue({
      sessionId: 'session-1',
      attentionKey: 'complete:run-1',
    });
    const args = defaultArgs({ openSessionFromShell });
    await renderLayer(args);
    expect(takePendingActivation).toHaveBeenCalledTimes(1);
    expect(openSessionFromShell).toHaveBeenCalledWith('session-1');

    await act(async () => {
      root.render(<DesktopAttentionLayer {...args} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(takePendingActivation).toHaveBeenCalledTimes(1);
    expect(openSessionFromShell).toHaveBeenCalledTimes(1);
  });

  it('AN-T61 dispatches presence and visible-session actions on change', async () => {
    const dispatch = vi.fn();
    const args = defaultArgs({ dispatch });
    await renderLayer(args);

    expect(dispatch).toHaveBeenCalledWith({ type: 'attention/presence', presence: 'active' });
    expect(onPresenceChanged).toHaveBeenCalledWith('active');
    expect(dispatch).toHaveBeenCalledWith({
      type: 'attention/visible-sessions',
      sessionIds: ['session-1'],
      conversationCovered: false,
    });

    dispatch.mockClear();
    onPresenceChanged.mockClear();
    await act(async () => {
      for (const listener of presenceListeners) {
        listener({ focused: false, documentVisible: true });
      }
    });
    expect(dispatch).toHaveBeenCalledWith({ type: 'attention/presence', presence: 'inactive' });
    expect(onPresenceChanged).toHaveBeenCalledWith('inactive');
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'attention/visible-sessions' }),
    );

    dispatch.mockClear();
    await act(async () => {
      root.render(<DesktopAttentionLayer {...args} activeSubPage="library" />);
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'attention/visible-sessions',
      sessionIds: [],
      conversationCovered: true,
    });
  });

  it('simulates clicking the in-app notice jump action', async () => {
    const openSessionFromShell = vi.fn(async () => undefined);
    await renderLayer(defaultArgs({ openSessionFromShell }));
    const firstArg = createControllerMock.mock.calls.at(0)?.at(0);
    expect(firstArg).toBeDefined();
    const deps = firstArg as unknown as {
      showInAppNotice: (notice: {
        tone?: string;
        title: string;
        body: string;
        action?: { label: string; sessionId: string };
      }) => void;
    };
    deps.showInAppNotice({
      tone: 'success',
      title: '已完成',
      body: 'piwin · Alpha',
      action: { label: '跳转', sessionId: 'session-1' },
    });
    const notice = showUiNotification.mock.calls.at(-1)?.[0] as {
      tone?: string;
      action?: { onClick: () => void };
    };
    expect(notice.tone).toBe('success');
    expect(notice.action).toBeDefined();
    notice.action?.onClick();
    expect(openSessionFromShell).toHaveBeenCalledWith('session-1');
  });
});
