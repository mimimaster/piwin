// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostClient } from '../host-client';
import { useComposerMedia } from './use-composer-media';
import { createInitialTestChatUiState, type ComposerMediaResult, pasteImage } from './composer-media-test-harness';

// Canvas decoding is unrelated to preserving the attachment draft.
vi.mock('../media-preview-bitmap.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../media-preview-bitmap.js')>();
  return { ...actual, beginComposerImagePreview: (file: File) => ({ lightboxUrl: URL.createObjectURL(file) }) };
});

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

  it('locks duplicate queued submissions until the structured intervention completes', async () => {
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
      const first = latest().handleSteerQueueSendNow('queued-1');
      const second = latest().handleSteerQueueSendNow('queued-1');
      await Promise.all([first, second]);
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
    vi.mocked(hostClient.request).mockRejectedValueOnce(new Error('connection lost'));
    await act(async () => {
      await latest().handleSteerQueueSendNow('queued-1');
      await latest().handleSteerQueueSendNow('queued-1');
    });
    expect(hostClient.request).toHaveBeenCalledTimes(3);

  });
  it('preserves text and pasted attachments instead of submitting a partial intervention', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const request = vi.fn();
    const dispatch = vi.fn();
    let captured: ComposerMediaResult | undefined;
    function Harness(): null {
      captured = useComposerMedia({
        hostClient: { request } as unknown as HostClient,
        state: {
          ...createInitialTestChatUiState(), activeSessionId: 'session-1',
          activeRunId: 'run-1', runPhase: 'streaming', streaming: true,
        },
        dispatch, agentMode: 'agent',
      });
      return null;
    }
    act(() => root?.render(<Harness />));
    const latest = (): ComposerMediaResult => {
      if (!captured) throw new Error('hook not rendered');
      return captured;
    };
    act(() => latest().setComposer('Use this screenshot'));
    pasteImage(latest);
    const attachments = latest().pendingAttachments;
    expect(attachments).toHaveLength(1);
    await act(async () => {
      expect(await latest().handleSteer()).toBe(false);
    });
    expect(request).not.toHaveBeenCalled();
    expect(latest().composer).toBe('Use this screenshot');
    expect(latest().pendingAttachments).toEqual(attachments);
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'user/steer' }));
  });

});
