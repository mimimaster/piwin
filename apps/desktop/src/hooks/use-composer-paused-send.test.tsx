// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostCommand, PromptInput } from '@piwin/contracts';
import type { HostClient } from '../host-client.js';
import { useComposerMedia } from './use-composer-media.js';
import {
  createInitialTestChatUiState,
  createSavedMediaResponse,
  type ComposerMediaResult,
} from './composer-media-test-harness.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('paused composer sends', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  function renderComposer(rejectPrompt = false) {
    const inputs: PromptInput[] = [];
    const request = vi.fn(async (command: HostCommand) => {
      if (command.type === 'session/prompt') {
        inputs.push(command.input);
        if (rejectPrompt) {
          return { type: 'response', command: command.type, success: false, error: 'rejected' };
        }
      }
      return createSavedMediaResponse(command.type);
    });
    const onResumeRun = vi.fn(async () => undefined);
    const onCompact = vi.fn(async () => true);
    const dispatch = vi.fn();
    let captured: ComposerMediaResult | undefined;
    function Harness() {
      captured = useComposerMedia({
        hostClient: { request } as unknown as HostClient,
        state: {
          ...createInitialTestChatUiState(),
          activeSessionId: 'session-1',
          runTerminal: { kind: 'paused', at: 1, checkpointId: 'checkpoint-1' },
        },
        dispatch,
        agentMode: 'agent',
        ensureSession: async () => 'session-1',
        onResumeRun,
        onCompact,
      });
      return null;
    }
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(<Harness />));
    return {
      request,
      inputs,
      dispatch,
      onResumeRun,
      onCompact,
      latest: (): ComposerMediaResult => {
        if (!captured) throw new Error('composer not rendered');
        return captured;
      },
    };
  }

  it.each(['先别继续，解释刚才的错误', '继续'])(
    'sends %s through ordinary prompt admission, never implicit resume',
    async (text) => {
      const harness = renderComposer();
      act(() => harness.latest().setComposer(text));
      await act(async () => harness.latest().handleSend());
      expect(harness.onResumeRun).not.toHaveBeenCalled();
      expect(harness.inputs).toHaveLength(1);
      expect(harness.inputs[0]).toMatchObject({ text, clientMessageId: expect.any(String) });
      expect(harness.inputs[0]?.source).not.toBe('resume');
      expect(harness.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'user/send', text }),
      );
      expect(harness.latest().composer).toBe('');
    },
  );

  it('runs /compact while paused instead of prompting or resuming', async () => {
    const harness = renderComposer();
    act(() => harness.latest().setComposer('/compact keep tools'));
    await act(async () => harness.latest().handleSend());
    expect(harness.onCompact).toHaveBeenCalledWith('keep tools');
    expect(harness.onResumeRun).not.toHaveBeenCalled();
    expect(harness.inputs).toHaveLength(0);
    expect(harness.latest().composer).toBe('');
  });

  it('keeps the draft on rejection and does not resume the old task', async () => {
    const harness = renderComposer(true);
    act(() => harness.latest().setComposer('换一个办法'));
    await act(async () => harness.latest().handleSend());
    expect(harness.onResumeRun).not.toHaveBeenCalled();
    expect(harness.latest().composer).toBe('换一个办法');
    expect(harness.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'user/send-rollback' }),
    );
  });

  it.each([false, true])('preserves attachment delivery with rejected=%s', async (rejected) => {
    const harness = renderComposer(rejected);
    const file = new File(['new instructions'], 'instructions.txt', { type: 'text/plain' });
    act(() => {
      harness.latest().setComposer('按这个附件调整');
      harness.latest().handleComposerDrop({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: { files: [file], items: [], getData: () => '' },
      } as unknown as Parameters<ComposerMediaResult['handleComposerDrop']>[0]);
    });
    expect(harness.latest().pendingAttachments).toHaveLength(1);
    await act(async () => harness.latest().handleSend());
    expect(harness.onResumeRun).not.toHaveBeenCalled();
    expect(harness.inputs).toHaveLength(1);
    expect(harness.inputs[0]?.attachments).toEqual([
      expect.objectContaining({ kind: 'media', id: 'asset-1' }),
    ]);
    expect(harness.latest().pendingAttachments).toHaveLength(rejected ? 1 : 0);
    expect(harness.latest().composer).toBe(rejected ? '按这个附件调整' : '');
  });
});
