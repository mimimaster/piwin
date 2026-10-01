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
  it('always offers Pi first and does not invent an unreported agent', () => {
    expect(draftAgentOptionsFrom([])).toEqual([{ agentId: 'pi', label: 'Pi', ready: true }]);
  });

  it('marks an agent ready only when the Host says so', () => {
    const notReady = draftAgentOptionsFrom([{ agentId: 'grok', state: 'unauthenticated' }]);
    expect(notReady.find((option) => option.agentId === 'grok')?.ready).toBe(false);

    const ready = draftAgentOptionsFrom([{ agentId: 'grok', state: 'ready' }]);
    expect(ready.find((option) => option.agentId === 'grok')?.ready).toBe(true);
  });

  it('names a backend from the enabled extension declaration', () => {
    const options = draftAgentOptionsFrom(
      [{ agentId: 'example-build', state: 'ready' }],
      [{ agentId: 'example-build', name: 'Example Build' }],
    );
    expect(options.find((option) => option.agentId === 'example-build')).toEqual({
      agentId: 'example-build',
      label: 'Example Build',
      ready: true,
      state: 'ready',
    });
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
    draftAgentId?: string | null;
    externalAgents?: readonly import('@piwin/contracts').ExternalAgentStatus[];
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
    expect(latest?.agentLabel).toBe('grok');
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

  describe('draft session controls', () => {
    it('resolves default grok options for clean slate draft', () => {
      mount({
        hostClient: { request: vi.fn() } as unknown as HostClient,
        dispatch: vi.fn(),
        sessionId: null,
        optionsBySession: {},
        draftAgentId: 'grok',
      });

      expect(latest?.options).not.toBeNull();
      expect(latest?.options?.agentId).toBe('grok');
      expect(latest?.options?.currentModelId).toBe('grok-4.7-fast');
      expect(latest?.options?.currentEffortId).toBe('high');
      expect(latest?.draftBackendModelId).toBe('grok-4.7-fast');
      expect(latest?.draftBackendEffortId).toBe('high');
      expect(latest?.options?.models.map((m) => m.id)).toEqual([
        'grok-4.7',
        'grok-4.7-fast',
        'grok-4.6',
        'grok-4.5',
      ]);
    });

    it('stays null when draftAgentId is pi', () => {
      mount({
        hostClient: { request: vi.fn() } as unknown as HostClient,
        dispatch: vi.fn(),
        sessionId: null,
        optionsBySession: {},
        draftAgentId: 'pi',
      });

      expect(latest?.options).toBeNull();
      expect(latest?.draftBackendModelId).toBeUndefined();
      expect(latest?.draftBackendEffortId).toBeUndefined();
    });

    it('allows switching model on draft without calling backend-set', () => {
      const request = vi.fn();
      mount({
        hostClient: { request } as unknown as HostClient,
        dispatch: vi.fn(),
        sessionId: null,
        optionsBySession: {},
        draftAgentId: 'grok',
      });

      expect(latest?.options?.currentModelId).toBe('grok-4.7-fast');

      act(() => latest?.selectModel('grok-4.7'));

      expect(latest?.options?.currentModelId).toBe('grok-4.7');
      expect(latest?.draftBackendModelId).toBe('grok-4.7');
      expect(request).not.toHaveBeenCalled();
    });

    it('allows switching effort on draft without calling backend-set', () => {
      const request = vi.fn();
      mount({
        hostClient: { request } as unknown as HostClient,
        dispatch: vi.fn(),
        sessionId: null,
        optionsBySession: {},
        draftAgentId: 'grok',
      });

      expect(latest?.options?.currentEffortId).toBe('high');

      act(() => latest?.selectEffort('xhigh'));

      expect(latest?.options?.currentEffortId).toBe('xhigh');
      expect(latest?.draftBackendEffortId).toBe('xhigh');
      expect(request).not.toHaveBeenCalled();
    });

    it('adopts models from existing session when available', () => {
      const customOptions = options({
        agentId: 'grok',
        models: [{ id: 'custom-grok', label: 'Custom Grok', efforts: ['low'] }],
        currentModelId: 'custom-grok',
      });
      mount({
        hostClient: { request: vi.fn() } as unknown as HostClient,
        dispatch: vi.fn(),
        sessionId: null,
        optionsBySession: { 'prev-session': customOptions },
        draftAgentId: 'grok',
      });

      expect(latest?.options?.currentModelId).toBe('custom-grok');
      expect(latest?.options?.models[0]?.id).toBe('custom-grok');
    });
  });
});

