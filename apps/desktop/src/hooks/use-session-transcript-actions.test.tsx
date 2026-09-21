// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { HostResponse } from '@piwin/contracts';
import { chatUiReducer, createInitialChatUiState, type ChatUiState } from '../chat-reducer.js';
import { useSessionTranscriptActions } from './use-session-transcript-actions.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function createState(): ChatUiState {
  let state = chatUiReducer(createInitialChatUiState(), { type: 'session/set', sessionId: 'long' });
  state = chatUiReducer(state, {
    type: 'session/load-messages',
    sessionId: 'long',
    messages: [
      { id: 'm100', role: 'user', text: 'resident', status: 'done', createdAt: '2026-09-21' },
    ],
    transcriptPage: {
      revision: 'r1',
      totalCount: 300,
      startIndex: 100,
      endIndex: 101,
      messageBytes: 100,
    },
  });
  if (state.transcriptWindow) state.transcriptWindow.cacheLimitReached = true;
  return state;
}
async function mountActions(state: ChatUiState) {
  const request = vi.fn(async (): Promise<HostResponse> => ({
    type: 'response',
    command: 'session/transcript-window',
    success: true,
    data: { status: 'not-found' },
  }));
  const dispatch = vi.fn();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let actions: ReturnType<typeof useSessionTranscriptActions> | undefined;
  function Harness() {
    actions = useSessionTranscriptActions({
      hostClient: { request },
      state,
      dispatch,
      dispatchNotification: vi.fn(),
    });
    return null;
  }
  await act(async () => root.render(<Harness />));
  if (!actions) throw new Error('Missing actions');
  return {
    actions,
    request,
    dispatch,
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

describe('continuous transcript history actions', () => {
  it('continues before the first resident row when the tail cache is full', async () => {
    const harness = await mountActions(createState());
    try {
      await act(async () => harness.actions.handleLoadOlderTranscript());
      expect(harness.request).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'session/transcript-window',
          query: expect.objectContaining({
            anchorMessageId: 'm100',
            beforeItems: 49,
            afterItems: 0,
          }),
        }),
      );
    } finally {
      await harness.cleanup();
    }
  });
  it('loads after the current history boundary with a bounded request', async () => {
    const harness = await mountActions(createState());
    try {
      await act(async () => harness.actions.handleLoadNewerTranscript());
      expect(harness.request).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'session/transcript-window',
          query: expect.objectContaining({
            anchorMessageId: 'm100',
            beforeItems: 0,
            afterItems: 49,
          }),
        }),
      );
    } finally {
      await harness.cleanup();
    }
  });
  it('ignores an in-flight history page after returning to live', async () => {
    const harness = await mountActions(createState());
    let resolveResponse: ((response: HostResponse) => void) | undefined;
    harness.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveResponse = resolve;
        }),
    );
    try {
      await act(async () => {
        const pending = harness.actions.handleLoadOlderTranscript();
        harness.actions.handleReturnToLiveTranscript();
        resolveResponse?.({
          type: 'response',
          command: 'session/transcript-window',
          success: true,
          data: { status: 'window', messages: [], window: {} },
        });
        await pending;
      });
      expect(harness.dispatch.mock.calls.map(([action]) => action.type)).toEqual([
        'session/return-to-live',
      ]);
    } finally {
      await harness.cleanup();
    }
  });
  it('keeps the full navigation index while sending a new turn', () => {
    const state = createState();
    state.userMessageIndex = {
      sessionId: 'long',
      revision: 'r1',
      totalUserMessages: 100,
      mode: 'exact',
      anchors: [],
      anchorBytes: 2,
    };
    const next = chatUiReducer(state, { type: 'user/send', text: 'continue' });
    expect(next.userMessageIndex).toBe(state.userMessageIndex);
    expect(next.userMessageIndexEpoch).toBeGreaterThan(state.userMessageIndexEpoch);
  });
});
