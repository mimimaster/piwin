// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionBackendOptions } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import type { ChatUiAction } from '../chat-reducer';
import { draftAgentOptionsFrom, useBackendSessionControls } from './use-backend-session-controls';

function options(overrides: Partial<SessionBackendOptions> = {}): SessionBackendOptions {
  return {
    agentId: 'grok',
    models: [{ id: 'grok-4', label: 'Grok 4', efforts: ['low', 'high'] }],
    currentModelId: 'grok-4',
    currentEffortId: 'low',
    modes: [
      { id: 'default', label: 'Default' },
      { id: 'plan', label: 'Plan' },
    ],
    currentModeId: 'default',
    modeConfirmed: true,
    commands: [],
    ...overrides,
  };
}

type Controls = ReturnType<typeof useBackendSessionControls>;

describe('draftAgentOptionsFrom', () => {
  it('always offers Pi first and defaults it to ready', () => {
    expect(draftAgentOptionsFrom([])).toEqual([{ agentId: 'pi', label: 'Pi', ready: true }]);
  });

  it('marks an agent ready only when the Host says so', () => {
    const notReady = draftAgentOptionsFrom([{ agentId: 'grok', state: 'unauthenticated' }]);
    expect(notReady.find((option) => option.agentId === 'grok')?.ready).toBe(false);

    const ready = draftAgentOptionsFrom([{ agentId: 'grok', state: 'ready' }]);
    expect(ready.find((option) => option.agentId === 'grok')?.ready).toBe(true);
  });

  it('ignores a duplicate pi entry from the Host', () => {
    const result = draftAgentOptionsFrom([{ agentId: 'pi', state: 'ready' }]);
    expect(result).toHaveLength(1);
  });
});

describe('useBackendSessionControls', () => {
  let container: HTMLElement;
  let root: Root;
  let latest: Controls | null = null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    latest = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  function mount(args: {
    hostClient: HostClient;
    dispatch: (action: ChatUiAction) => void;
    sessionId: string | null;
    optionsBySession: Record<string, SessionBackendOptions>;
  }): void {
    function Harness(): null {
      latest = useBackendSessionControls(args);
      return null;
    }
    act(() => {
      root.render(<Harness />);
    });
  }

  it('exposes the bound options and agent label', () => {
    mount({
      hostClient: { request: vi.fn() } as unknown as HostClient,
      dispatch: vi.fn(),
      sessionId: 's-1',
      optionsBySession: { 's-1': options() },
    });

    expect(latest?.options?.agentId).toBe('grok');
    expect(latest?.agentLabel).toBe('Grok Build');
  });

  it('stays null for a Pi session with no backend options', () => {
    mount({
      hostClient: { request: vi.fn() } as unknown as HostClient,
      dispatch: vi.fn(),
      sessionId: 's-1',
      optionsBySession: {},
    });
    expect(latest?.options).toBeNull();
    expect(latest?.agentLabel).toBeNull();
  });

  it('writes a model selection through session/backend-set', () => {
    const request = vi.fn().mockResolvedValue({ success: true, data: {} });
    const dispatch = vi.fn();
    mount({
      hostClient: { request } as unknown as HostClient,
      dispatch,
      sessionId: 's-1',
      optionsBySession: { 's-1': options() },
    });

    act(() => latest?.selectModel('grok-4-fast'));

    expect(dispatch).toHaveBeenCalledWith({
      type: 'session/backend-updated',
      sessionId: 's-1',
      options: expect.objectContaining({ currentModelId: 'grok-4-fast' }),
    });
    expect(request).toHaveBeenCalledWith({
      type: 'session/backend-set',
      sessionId: 's-1',
      modelId: 'grok-4-fast',
    });
  });

  it('marks a mode pending until the Host confirms it', async () => {
    const request = vi.fn().mockResolvedValue({ success: true, data: {} });
    const dispatch = vi.fn();
    mount({
      hostClient: { request } as unknown as HostClient,
      dispatch,
      sessionId: 's-1',
      optionsBySession: { 's-1': options() },
    });

    act(() => latest?.selectMode('plan'));

    // Optimistic: the request is pending, not claimed as active.
    expect(dispatch).toHaveBeenCalledWith({
      type: 'session/backend-updated',
      sessionId: 's-1',
      options: expect.objectContaining({ currentModeId: 'plan', modeConfirmed: false }),
    });

    // No live process → nothing to confirm; settle rather than spin forever.
    await act(async () => {
      await Promise.resolve();
    });
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'session/backend-updated',
      sessionId: 's-1',
      options: expect.objectContaining({ modeConfirmed: true }),
    });
  });

  it('adopts the authoritative options the Host returns', async () => {
    const confirmed = options({ currentModeId: 'plan', modeConfirmed: true });
    const request = vi.fn().mockResolvedValue({ success: true, data: { options: confirmed } });
    const dispatch = vi.fn();
    mount({
      hostClient: { request } as unknown as HostClient,
      dispatch,
      sessionId: 's-1',
      optionsBySession: { 's-1': options() },
    });

    act(() => latest?.selectMode('plan'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'session/backend-updated',
      sessionId: 's-1',
      options: confirmed,
    });
  });

  it('fetches backend options once when the session is not hydrated yet', async () => {
    const request = vi.fn().mockResolvedValue({
      success: true,
      data: { agentId: 'grok', options: options() },
    });
    const dispatch = vi.fn();
    mount({
      hostClient: { request } as unknown as HostClient,
      dispatch,
      sessionId: 's-1',
      optionsBySession: {},
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(request).toHaveBeenCalledWith({ type: 'session/backend-get', sessionId: 's-1' });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'session/backend-hydrated',
      sessionId: 's-1',
      options: options(),
    });
  });

  it('does not fetch when options are already bound', () => {
    const request = vi.fn();
    mount({
      hostClient: { request } as unknown as HostClient,
      dispatch: vi.fn(),
      sessionId: 's-1',
      optionsBySession: { 's-1': options() },
    });
    expect(request).not.toHaveBeenCalled();
  });
});
