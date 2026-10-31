// @vitest-environment happy-dom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialChatUiState, type ChatUiState } from '../conversation/chat-reducer.js';
import type { HostClient } from '../host/host-client.js';
import {
  buildSessionStartupSnapshot,
  createSessionStartupState,
  readSessionStartupSnapshot,
  writeSessionStartupSnapshot,
} from '../session/session-startup-cache.js';
import { useSessionStartupCache } from './use-session-startup-cache.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('session startup cache lifecycle', () => {
  let root: Root;
  let container: HTMLDivElement;
  let state: ChatUiState;
  let hostClient: HostClient;
  const handleResumeSession = vi.fn(async () => undefined);
  function Harness() {
    useSessionStartupCache({ hostClient, state, handleResumeSession });
    return <span>{state.messages[0]?.text}</span>;
  }
  function render() {
    act(() =>
      root.render(
        <StrictMode>
          <Harness />
        </StrictMode>,
      ),
    );
  }
  function savedState(): ChatUiState {
    return {
      ...createInitialChatUiState(),
      hostReady: true,
      activeSessionId: 'saved',
      transcriptOwnerSessionId: 'saved',
      messages: [
        {
          id: 'reply',
          role: 'assistant',
          text: 'Saved reply',
          thinking: '',
          tools: [],
          attachments: [],
          status: 'done',
        },
      ],
    };
  }
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    handleResumeSession.mockClear();
    hostClient = { getTransport: () => 'live' } as unknown as HostClient;
    writeSessionStartupSnapshot('local', buildSessionStartupSnapshot(savedState()));
    state = createSessionStartupState(hostClient);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
    vi.useRealTimers();
  });

  it('keeps the cached body visible and refreshes once when the Host becomes ready', () => {
    render();
    expect(container.textContent).toBe('Saved reply');
    expect(handleResumeSession).not.toHaveBeenCalled();
    state = { ...state, hostReady: true };
    render();
    render();
    expect(handleResumeSession).toHaveBeenCalledTimes(1);
    expect(handleResumeSession).toHaveBeenCalledWith('saved', {
      scope: { kind: 'general' },
      quiet: true,
      refresh: true,
    });
    expect(container.textContent).toBe('Saved reply');
  });

  it.each([null, 'clicked'])(
    'lets a newer selection (%s) cancel automatic restore',
    (sessionId) => {
      render();
      state = { ...state, activeSessionId: sessionId };
      render();
      state = { ...state, hostReady: true };
      render();
      expect(handleResumeSession).not.toHaveBeenCalled();
    },
  );

  it('flushes the latest body on background/close before the debounce has elapsed', () => {
    state = savedState();
    render();
    state = { ...state, messages: state.messages.map((row) => ({ ...row, text: 'Latest reply' })) };
    render();
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(readSessionStartupSnapshot('local')?.messages[0]?.text).toBe('Latest reply');
  });

  it('never overwrites a good snapshot with an unfinished target or a disconnected view', () => {
    render();
    state = { ...state, activeSessionId: 'loading', hostReady: true };
    render();
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(readSessionStartupSnapshot('local')?.sessionId).toBe('saved');
    state = { ...savedState(), hostReady: false };
    render();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(readSessionStartupSnapshot('local')?.sessionId).toBe('saved');
  });

  it('clears the selected-chat preview after New', () => {
    state = { ...createInitialChatUiState(), hostReady: true };
    render();
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(readSessionStartupSnapshot('local')).toBeUndefined();
  });
});
