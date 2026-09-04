// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostClient } from '../host-client';
import { useComposerMedia } from './use-composer-media';
import { createInitialTestChatUiState, type ComposerMediaResult } from './composer-media-test-harness';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('queued-turn send-now with structured input', () => {
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

  it('converts a queued message that carries context refs into a Run intervention', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const dispatch = vi.fn();
    const contextRefs = [
      { kind: 'selection' as const, snapshotText: 'quoted mapping', label: 'quoted' },
    ];
    const hostClient = {
      request: vi.fn(async () => ({
        type: 'response' as const,
        command: 'run/intervention-submit',
        success: true as const,
        data: {
          intervention: {
            interventionId: 'intervention-1',
            revision: 1,
            sessionId: 'session-1',
            runId: 'run-1',
            runtimeGenerationId: 'generation-1',
            sequence: 1,
            userMessageId: 'user-queued-1',
            status: 'pending' as const,
            input: { text: 'Adjust the model mapping', contextRefs },
            submittedAt: '2026-08-15T00:00:00.000Z',
            updatedAt: '2026-08-15T00:00:00.000Z',
          },
          queuedTurn: {
            queuedTurnId: 'queued-1',
            revision: 4,
            sessionId: 'session-1',
            sequence: 1,
            userMessageId: 'user-queued-1',
            mode: 'next' as const,
            status: 'cancelled' as const,
            input: { text: 'Adjust the model mapping', contextRefs },
            submittedAt: '2026-08-15T00:00:00.000Z',
            updatedAt: '2026-08-15T00:00:00.000Z',
            terminalReason: 'converted-to-intervention' as const,
          },
        },
      })),
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
          queuedTurnsBySession: {
            'session-1': [
              {
                queuedTurnId: 'queued-1',
                revision: 3,
                sessionId: 'session-1',
                sequence: 1,
                userMessageId: 'user-queued-1',
                mode: 'next',
                status: 'pending',
                input: { text: 'Adjust the model mapping', contextRefs },
                submittedAt: '2026-08-15T00:00:00.000Z',
                updatedAt: '2026-08-15T00:00:00.000Z',
              },
            ],
          },
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

    await act(async () => {
      await latest().handleSteerQueueSendNow('queued-1');
    });

    expect(hostClient.request).toHaveBeenCalledTimes(1);
    const command = vi.mocked(hostClient.request).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(command).toMatchObject({
      type: 'run/intervention-submit',
      input: { text: 'Adjust the model mapping', contextRefs },
      adoptQueuedTurn: { queuedTurnId: 'queued-1', expectedRevision: 3 },
    });
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    );
  });
});
