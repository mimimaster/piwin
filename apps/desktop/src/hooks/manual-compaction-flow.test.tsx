// @vitest-environment happy-dom
import { act, useReducer, type Dispatch } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { chatUiReducer, type ChatUiAction } from '../conversation/chat-reducer.js';
import { CompactionActivity } from '../conversation/compaction-activity.js';
import type { HostClient } from '../host/host-client.js';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens.js';
import { createInitialTestChatUiState } from './composer-media-test-harness.js';
import { useComposerMedia } from './use-composer-media.js';
import { useSessionRunActions } from './use-session-run-actions.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('manual compaction flow', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  it('clears /compact immediately and renders the native lifecycle after a completed run', async () => {
    let finish: ((response: HostResponse) => void) | undefined;
    const request = vi.fn((_command: HostCommand) => new Promise<HostResponse>((resolve) => {
      finish = resolve;
    }));
    const hostClient = { request } as unknown as HostClient;
    let composer: ReturnType<typeof useComposerMedia> | undefined;
    let dispatch: Dispatch<ChatUiAction> | undefined;
    function Harness() {
      const [state, send] = useReducer(chatUiReducer, {
        ...createInitialTestChatUiState(), activeSessionId: 's1', lastTerminalRunId: 'old-run',
      });
      dispatch = send;
      const actions = useSessionRunActions({
        hostClient, state, dispatch: send, dispatchNotification: vi.fn(), locale: 'en',
      });
      composer = useComposerMedia({
        hostClient, state, dispatch: send, agentMode: 'agent', onCompact: actions.handleCompact,
      });
      return state.compactionActivity ? <CompactionActivity activity={state.compactionActivity} locale="en" /> : null;
    }
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}><Harness /></PiwinUiProvider>));
    act(() => composer?.setComposer('/compact keep decisions'));
    await act(async () => { await composer?.handleSend(); });
    expect(composer?.composer).toBe('');
    expect(request).toHaveBeenCalledWith({ type: 'session/compact', sessionId: 's1', customInstructions: 'keep decisions' });

    act(() => dispatch?.({ type: 'event', sessionId: 's1', event: { type: 'compaction/start', reason: 'manual' } }));
    expect(container.querySelector('[data-phase="running"]')).not.toBeNull();
    act(() => dispatch?.({ type: 'event', sessionId: 's1', event: { type: 'compaction/end', reason: 'manual', ok: true, summary: 'kept' } }));
    expect(container.querySelector('[data-phase="succeeded"]')).not.toBeNull();
    await act(async () => {
      finish?.({ type: 'response', command: 'session/compact', success: true, data: { ok: true } });
      await Promise.resolve();
    });
  });
});
