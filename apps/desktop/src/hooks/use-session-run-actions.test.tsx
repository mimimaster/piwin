// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostCommand } from '@piwin/contracts';
import type { HostClient } from '../host-client.js';
import { createInitialTestChatUiState } from './composer-media-test-harness.js';
import { useSessionRunActions } from './use-session-run-actions.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('handleCompact', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  function renderActions(state: ReturnType<typeof createInitialTestChatUiState>) {
    const commands: HostCommand[] = [];
    const request = vi.fn(async (command: HostCommand) => {
      commands.push(command);
      if (command.type === 'session/compact') {
        return {
          type: 'response' as const,
          command: 'session/compact',
          success: true as const,
          data: { ok: true, tokensAfter: 1200 },
        };
      }
      return { type: 'response' as const, command: command.type, success: true as const, data: {} };
    });
    const dispatchNotification = vi.fn();
    let captured: ReturnType<typeof useSessionRunActions> | undefined;
    function Harness() {
      captured = useSessionRunActions({
        hostClient: { request } as unknown as HostClient,
        state,
        dispatch: vi.fn(),
        dispatchNotification,
        locale: 'en',
      });
      return null;
    }
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(<Harness />));
    return {
      commands,
      dispatchNotification,
      latest: () => {
        if (!captured) throw new Error('hook not rendered');
        return captured;
      },
    };
  }

  it('sends session/compact for an idle session', async () => {
    const harness = renderActions({
      ...createInitialTestChatUiState(),
      activeSessionId: 'session-1',
    });
    let ok = false;
    await act(async () => {
      ok = await harness.latest().handleCompact('keep the plan');
    });
    expect(ok).toBe(true);
    expect(harness.commands).toEqual([
      {
        type: 'session/compact',
        sessionId: 'session-1',
        customInstructions: 'keep the plan',
      },
    ]);
  });

  it('sends session/compact while the previous run is paused', async () => {
    const harness = renderActions({
      ...createInitialTestChatUiState(),
      activeSessionId: 'session-1',
      runTerminal: { kind: 'paused', at: 1, checkpointId: 'checkpoint-1' },
      streaming: false,
      runPhase: 'idle',
    });
    await act(async () => {
      await harness.latest().handleCompact();
    });
    expect(harness.commands).toEqual([{ type: 'session/compact', sessionId: 'session-1' }]);
  });

  it('does not compact while a run is still streaming', async () => {
    const harness = renderActions({
      ...createInitialTestChatUiState(),
      activeSessionId: 'session-1',
      streaming: true,
      runPhase: 'streaming',
      activeRunId: 'run-1',
    });
    let ok = true;
    await act(async () => {
      ok = await harness.latest().handleCompact();
    });
    expect(ok).toBe(false);
    expect(harness.commands).toEqual([]);
    expect(harness.dispatchNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'notify/push',
        notification: expect.objectContaining({
          level: 'error',
          message: expect.stringMatching(/still in progress/i),
        }),
      }),
    );
  });
});
