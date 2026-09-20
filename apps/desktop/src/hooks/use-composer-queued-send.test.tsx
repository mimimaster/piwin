// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostClient } from '../host-client';
import { useComposerMedia } from './use-composer-media';
import {
  createInitialTestChatUiState,
  type ComposerMediaResult,
} from './composer-media-test-harness';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('useComposerMedia queued send', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    container?.remove();
    root = null;
    container = null;
  });

  it('paints the user message before a running-session queue admission ACK', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const dispatch = vi.fn();
    let resolveAdmission:
      ((response: Awaited<ReturnType<HostClient['request']>>) => void) | undefined;
    const admission = new Promise<Awaited<ReturnType<HostClient['request']>>>((resolve) => {
      resolveAdmission = resolve;
    });
    const hostClient = {
      request: vi.fn((command: { type: string }) => {
        if (command.type === 'session/queued-turn-list') {
          return Promise.resolve({
            type: 'response' as const,
            command: command.type,
            success: true as const,
            data: { queueRevision: 1, queuedTurns: [] },
          });
        }
        return admission;
      }),
    } as unknown as HostClient;
    let captured: ComposerMediaResult | undefined;

    function Harness(): null {
      captured = useComposerMedia({
        hostClient,
        state: {
          ...createInitialTestChatUiState(),
          activeSessionId: 'session-1',
          activeRunId: 'run-1',
          runPhase: 'streaming',
          streaming: true,
        },
        dispatch,
        agentMode: 'agent',
      });
      return null;
    }

    act(() => root?.render(<Harness />));
    const latest = (): ComposerMediaResult => {
      if (captured === undefined) throw new Error('hook not rendered');
      return captured;
    };
    act(() => latest().setComposer('/goal focus on the failing test'));
    let sendPromise: Promise<void> | undefined;
    act(() => {
      sendPromise = latest().handleSend();
    });

    const command = vi.mocked(hostClient.request).mock.calls[0]?.[0] as {
      type: string;
      userMessageId: string;
      input: { text: string; agentMode?: string };
    };
    expect(command.type).toBe('session/queued-turn-submit');
    expect(command.input).toMatchObject({ text: 'focus on the failing test', agentMode: 'goal' });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'user/queue',
        text: 'focus on the failing test',
        clientMessageId: command.userMessageId,
        agentMode: 'goal',
      }),
    );
    expect(latest().composer).toBe('');

    resolveAdmission?.({
      type: 'response',
      command: 'session/queued-turn-submit',
      success: true,
      data: {
        queuedTurn: {
          queuedTurnId: 'queued-1',
          revision: 1,
          sessionId: 'session-1',
          sequence: 1,
          userMessageId: command.userMessageId,
          mode: 'next',
          status: 'pending',
          input: command.input,
          submittedAt: '2026-08-15T00:00:00.000Z',
          updatedAt: '2026-08-15T00:00:00.000Z',
        },
      },
    });
    await act(async () => {
      await sendPromise;
      await Promise.resolve();
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session/queued-turn-updated' }),
    );
  });
});
