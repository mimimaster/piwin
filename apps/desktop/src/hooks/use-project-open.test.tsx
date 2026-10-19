// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse, SessionSummary } from '@piwin/contracts';
import type { HostClient } from '../host-client.js';
import { chatUiReducer, createInitialChatUiState, type ChatUiAction } from '../chat-reducer.js';
import { useProjectOpen } from './use-project-open.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('not initialized');
  };
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve: (value: T) => resolve(value) };
}

describe('project session restore', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  function setup() {
    const activation = deferred<HostResponse>();
    const list = deferred<SessionSummary[]>();
    let state = createInitialChatUiState();
    const selected: (string | null)[] = [];
    const dispatch = vi.fn((action: ChatUiAction) => {
      state = chatUiReducer(state, action);
      selected.push(state.activeSessionId);
    });
    const hostClient = {
      getTransport: () => 'live',
      request: vi.fn((command: HostCommand) => {
        if (command.type !== 'project/open') throw new Error(`Unexpected ${command.type}`);
        return activation.promise;
      }),
    } as unknown as HostClient;
    const resume = vi.fn(async (sessionId: string) => {
      dispatch({ type: 'session/set', sessionId, awaitTranscript: true });
      dispatch({ type: 'session/load-messages', sessionId, messages: [] });
    });
    let epoch = 0;
    const hydrateSessions = vi.fn(() => list.promise);
    const args = {
      hostClient,
      dispatch,
      dispatchNotification: vi.fn(),
      setProjectPickerOpen: vi.fn(),
      showArchivedSessions: false,
      beginNavigation: () => ++epoch,
      navigationEpochMatches: (candidate: number) => candidate === epoch,
      hydrateSessions,
      handleResumeSession: resume,
      ensureSession: vi.fn(async () => null),
    };
    let open: ReturnType<typeof useProjectOpen> | undefined;
    function Harness() {
      open = useProjectOpen(args);
      return null;
    }
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(<Harness />);
    });
    return {
      activation,
      list,
      selected,
      resume,
      dispatch,
      state: () => state,
      start() {
        if (!open) throw new Error('missing project opener');
        return open('/repo', { resumeSessionId: 'saved', autoTrust: false });
      },
      cancel() {
        epoch += 1;
        dispatch({ type: 'session/clear-active' });
      },
    };
  }

  it('selects once before activation and resumes without waiting for the sidebar', async () => {
    const hook = setup();
    const pending = hook.start();
    expect(hook.state()).toMatchObject({ activeSessionId: 'saved', awaitingTranscript: true });
    hook.activation.resolve({
      type: 'response',
      command: 'project/open',
      success: true,
      data: { path: '/repo', trusted: true },
    });
    await pending;
    expect(hook.resume).toHaveBeenCalledWith(
      'saved',
      expect.objectContaining({ projectAlreadyActivated: true }),
    );
    expect(hook.selected.every((id) => id === 'saved')).toBe(true);
    expect(hook.state()).toMatchObject({ activeSessionId: 'saved', awaitingTranscript: false });
    hook.list.resolve([]);
  });

  it('settles the loading surface if project activation fails', async () => {
    const hook = setup();
    const pending = hook.start();
    hook.activation.resolve({
      type: 'response',
      command: 'project/open',
      success: false,
      error: 'missing project',
    });
    await pending;
    expect(hook.state().awaitingTranscript).toBe(false);
    expect(hook.resume).not.toHaveBeenCalled();
  });

  it('does not restore after the user has left during project activation', async () => {
    const hook = setup();
    const pending = hook.start();
    hook.cancel();
    hook.activation.resolve({
      type: 'response',
      command: 'project/open',
      success: true,
      data: { path: '/repo', trusted: true },
    });
    await pending;
    expect(hook.resume).not.toHaveBeenCalled();
    expect(hook.state().activeSessionId).toBeNull();
  });
});
