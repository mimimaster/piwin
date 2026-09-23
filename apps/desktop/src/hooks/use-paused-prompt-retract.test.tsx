// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessageUi, ChatUiState } from '../chat-reducer';
import type { HostClient } from '../host-client';
import { useComposerMedia } from './use-composer-media';
import { createInitialTestChatUiState, type ComposerMediaResult } from './composer-media-test-harness';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function row(id: string, role: ChatMessageUi['role'], extra: Partial<ChatMessageUi> = {}): ChatMessageUi {
  return { id, role, text: '', thinking: '', tools: [], attachments: [], status: 'done', ...extra };
}

const quoted = { kind: 'selection' as const, snapshotText: 'quoted', label: 'quoted' };

function liveTurn(reply: Partial<ChatMessageUi> = {}): ChatUiState {
  return {
    ...createInitialTestChatUiState(),
    activeSessionId: 'session-1',
    activeRunId: 'run-1',
    runPhase: 'streaming',
    streaming: true,
    messages: [
      row('u1', 'user', { text: 'old' }),
      row('a1', 'assistant', { text: 'old reply' }),
      row('u2', 'user', { text: 'half-written question' }),
      row('a2', 'assistant', { status: 'streaming', ...reply }),
    ],
  };
}

function paused(state: ChatUiState): ChatUiState {
  return {
    ...state,
    activeRunId: null,
    runPhase: 'idle',
    streaming: false,
    runTerminal: { kind: 'paused', at: 1, checkpointId: 'checkpoint-1' },
  };
}

describe('usePausedPromptRetract via useComposerMedia', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function mount(initial: ChatUiState, hostClient: HostClient) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const dispatch = vi.fn();
    const restorePendingContextRefs = vi.fn();
    let captured: ComposerMediaResult | undefined;
    let state = initial;
    function Harness(): null {
      captured = useComposerMedia({
        hostClient,
        state,
        dispatch,
        agentMode: 'agent',
        getPendingContextRefs: () => [],
        restorePendingContextRefs,
      });
      return null;
    }
    act(() => root?.render(<Harness />));
    return {
      dispatch,
      restorePendingContextRefs,
      latest: (): ComposerMediaResult => {
        if (captured === undefined) throw new Error('hook not rendered');
        return captured;
      },
      rerender: async (next: ChatUiState): Promise<void> => {
        state = next;
        await act(async () => {
          root?.render(<Harness />);
        });
      },
    };
  }

  it('puts a prompt stopped before any reply back into the composer', async () => {
    const hostClient = {
      request: vi.fn(async (command: { type: string }) => ({
        type: 'response' as const,
        command: command.type,
        success: true as const,
        data: {
          sessionId: 'session-1',
          removedCount: 2,
          remainingCount: 2,
          messages: [
            { id: 'u1', role: 'user', text: 'old', status: 'done', createdAt: 'x' },
            { id: 'a1', role: 'assistant', text: 'old reply', status: 'done', createdAt: 'x' },
          ],
          retracted: { userMessageId: 'u2', text: 'half-written question', contextRefs: [quoted] },
        },
      })),
    } as unknown as HostClient;
    const harness = mount(liveTurn(), hostClient);

    act(() => harness.latest().notePauseRequested());
    await harness.rerender(paused(liveTurn()));

    expect(hostClient.request).toHaveBeenCalledWith({
      type: 'session/retract-paused-prompt',
      sessionId: 'session-1',
      checkpointId: 'checkpoint-1',
      messageProjection: 'tail',
    });
    expect(harness.latest().composer).toBe('half-written question');
    expect(harness.restorePendingContextRefs).toHaveBeenCalledWith([quoted]);
    expect(harness.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session/branch-switched', sessionId: 'session-1' }),
    );
    expect(harness.dispatch).toHaveBeenCalledWith({ type: 'run/terminal-dismiss' });
  });

  it('keeps an ordinary pause once the reply has started', async () => {
    const hostClient = { request: vi.fn() } as unknown as HostClient;
    const started = liveTurn({ text: 'Sure, first' });
    const harness = mount(started, hostClient);

    act(() => harness.latest().notePauseRequested());
    await harness.rerender(paused(started));

    expect(hostClient.request).not.toHaveBeenCalled();
    expect(harness.latest().composer).toBe('');
  });

  it('does not retract a later pause the user never pressed here', async () => {
    const hostClient = { request: vi.fn() } as unknown as HostClient;
    const harness = mount(liveTurn(), hostClient);

    act(() => harness.latest().notePauseRequested());
    // This turn completed instead of pausing; the candidate must not linger.
    await harness.rerender({ ...liveTurn(), runTerminal: { kind: 'complete', at: 1 } });
    await harness.rerender(paused(liveTurn()));

    expect(hostClient.request).not.toHaveBeenCalled();
  });
});
