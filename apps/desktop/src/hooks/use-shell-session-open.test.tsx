// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialChatUiState, type ChatUiState } from '../chat-reducer';
import {
  CONVERSATION_PANE_LAYOUT_VERSION,
  PRIMARY_CONVERSATION_PANE_ID,
  createConversationPaneLayout,
  type ConversationPaneLayout,
} from '../conversation-pane-layout';
import {
  useShellSessionOpen,
  type ShellSessionOpen,
  type ShellSessionOpenArgs,
} from './use-shell-session-open';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function sessionState(sessionId: string): ChatUiState {
  const item = { id: sessionId, name: sessionId, scope: { kind: 'general' as const } };
  return {
    ...createInitialChatUiState(),
    generalSessions: [item],
    sessionEntitiesById: { [sessionId]: item },
  };
}

function multiLeafLayout(existingSessionId: string): ConversationPaneLayout {
  return {
    version: CONVERSATION_PANE_LAYOUT_VERSION,
    root: {
      kind: 'split',
      splitId: 'split-1',
      orientation: 'row',
      ratio: 0.5,
      first: {
        kind: 'leaf',
        paneId: PRIMARY_CONVERSATION_PANE_ID,
        sessionId: 'other-session',
      },
      second: {
        kind: 'leaf',
        paneId: 'pane-existing',
        sessionId: existingSessionId,
      },
    },
    activePaneId: PRIMARY_CONVERSATION_PANE_ID,
    maximizedPaneId: null,
  };
}

describe('useShellSessionOpen AN-T37', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function renderOpen(args: ShellSessionOpenArgs): ShellSessionOpen {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    let latest: ShellSessionOpen | undefined;
    function Harness(): null {
      latest = useShellSessionOpen(args);
      return null;
    }
    act(() => {
      root?.render(<Harness />);
    });
    if (latest === undefined) {
      throw new Error('useShellSessionOpen was not rendered');
    }
    return latest;
  }

  function createArgs(overrides: Partial<ShellSessionOpenArgs> = {}): {
    args: ShellSessionOpenArgs;
    openOrFocusSession: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    bindSession: ReturnType<typeof vi.fn>;
    handleResumeSession: ReturnType<typeof vi.fn>;
  } {
    const openOrFocusSession = vi.fn();
    const focus = vi.fn();
    const bindSession = vi.fn();
    const handleResumeSession = vi.fn(async () => undefined);
    const args: ShellSessionOpenArgs = {
      setActiveSubPage: vi.fn(),
      isOverlayPresentation: false,
      shell: { closeOverlay: vi.fn() },
      state: sessionState('sess-1'),
      conversationPanesEnabled: true,
      dockingEnabled: false,
      layoutMode: 'desktop',
      dockingWorkspace: { openOrFocusSession },
      conversationPaneController: {
        layout: createConversationPaneLayout('primary'),
        focus,
        bindSession,
      },
      handleResumeSession,
      ...overrides,
    };
    return { args, openOrFocusSession, focus, bindSession, handleResumeSession };
  }

  it('docking same-scope calls openOrFocusSession', async () => {
    const { args, openOrFocusSession, handleResumeSession } = createArgs({
      dockingEnabled: true,
    });
    const open = renderOpen(args);
    await act(async () => {
      await open('sess-1');
    });
    expect(openOrFocusSession).toHaveBeenCalledWith('sess-1');
    expect(handleResumeSession).toHaveBeenCalledWith('sess-1');
  });

  it('multi-leaf existing session focuses that leaf', async () => {
    const focus = vi.fn();
    const bindSession = vi.fn();
    const handleResumeSession = vi.fn(async () => undefined);
    const { args } = createArgs({
      conversationPaneController: {
        layout: multiLeafLayout('sess-1'),
        focus,
        bindSession,
      },
      handleResumeSession,
    });
    const open = renderOpen(args);
    await act(async () => {
      await open('sess-1');
    });
    expect(focus).toHaveBeenCalledWith('pane-existing');
    expect(bindSession).not.toHaveBeenCalled();
    expect(handleResumeSession).not.toHaveBeenCalled();
  });

  it('fallback calls handleResumeSession', async () => {
    const { args, openOrFocusSession, focus, handleResumeSession } = createArgs();
    const open = renderOpen(args);
    await act(async () => {
      await open('sess-1');
    });
    expect(openOrFocusSession).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    expect(handleResumeSession).toHaveBeenCalledWith('sess-1');
  });
});
