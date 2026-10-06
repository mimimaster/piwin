// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExternalAgentStatus, SessionBackendBinding, SessionBackendOptions } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import type { ChatUiAction } from '../chat-reducer';
import { setBackendOptions } from '../agent-backend-state';
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

function statusFor(catalog: SessionBackendOptions): ExternalAgentStatus {
  return {
    agentId: catalog.agentId,
    state: 'ready',
    binaryPath: '/fake/grok',
    version: '1.0.46',
    supportStatus: 'verified',
    checkedAt: '2026-10-03T08:00:00Z',
    options: catalog,
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

  let mountedArgs: Parameters<typeof useBackendSessionControls>[0] | null = null;
  function Harness(): null {
    if (mountedArgs === null) throw new Error('test args not mounted');
    latest = useBackendSessionControls(mountedArgs);
    return null;
  }

  function mount(args: {
    hostClient: HostClient;
    dispatch: (action: ChatUiAction) => void;
    sessionId: string | null;
    optionsBySession: Record<string, SessionBackendOptions>;
    draftAgentId?: string | null;
    sessionBackend?: SessionBackendBinding;
    externalAgents?: readonly import('@piwin/contracts').ExternalAgentStatus[];
  }): void {
    mountedArgs = args;
    act(() => {
      root.render(<Harness />);
    });
  }

  function mountStore(args: {
    hostClient: HostClient;
    sessionId: string;
    optionsBySession: Record<string, SessionBackendOptions>;
  }): {
    dispatches: ChatUiAction[];
    setSessionId: (sessionId: string | null) => void;
    setOptionsBySession: (optionsBySession: Record<string, SessionBackendOptions>) => void;
    optionsBySession: () => Record<string, SessionBackendOptions>;
  } {
    const dispatches: ChatUiAction[] = [];
    const snapshot = { optionsBySession: args.optionsBySession };
    const controls = {
      setSessionId: (_sessionId: string | null) => {},
      setOptionsBySession: (_optionsBySession: Record<string, SessionBackendOptions>) => {},
    };
    function StoreHarness(): null {
      const [sessionId, setSessionId] = useState<string | null>(args.sessionId);
      const [optionsBySession, setOptionsBySession] = useState(args.optionsBySession);
      snapshot.optionsBySession = optionsBySession;
      controls.setSessionId = setSessionId;
      controls.setOptionsBySession = setOptionsBySession;
      const dispatch = (action: ChatUiAction) => {
        dispatches.push(action);
        if (action.type === 'session/backend-updated') {
          setOptionsBySession((previous) =>
            setBackendOptions(previous, action.sessionId, action.options),
          );
        }
      };
      latest = useBackendSessionControls({
        hostClient: args.hostClient,
        dispatch,
        sessionId,
        optionsBySession,
      });
      return null;
    }
    act(() => {
      root.render(<StoreHarness />);
    });
    return {
      dispatches,
      setSessionId: (sessionId) => controls.setSessionId(sessionId),
      setOptionsBySession: (optionsBySession) => controls.setOptionsBySession(optionsBySession),
      optionsBySession: () => snapshot.optionsBySession,
    };
  }

  it('exposes the bound options and agent label', () => {
    mount({
      hostClient: {
        request: vi.fn().mockResolvedValue({ success: true, data: { agents: [] } }),
      } as unknown as HostClient,
      dispatch: vi.fn(),
      sessionId: 's-1',
      optionsBySession: { 's-1': options() },
    });

    expect(latest?.options?.agentId).toBe('grok');
    expect(latest?.agentLabel).toBe('grok');
  });

  it('stays null for a Pi session with no backend options', () => {
    mount({
      hostClient: {
        request: vi.fn().mockResolvedValue({ success: true, data: { agents: [] } }),
      } as unknown as HostClient,
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

  it('keeps a model pick when session/backend-set succeeds without live options', async () => {
    const request = vi.fn().mockResolvedValue({ success: true, data: {} });
    const dispatch = vi.fn();
    mount({
      hostClient: { request } as unknown as HostClient,
      dispatch,
      sessionId: 's-1',
      optionsBySession: { 's-1': options({ currentModelId: 'grok-4' }) },
    });

    act(() => latest?.selectModel('grok-4-fast'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'session/backend-updated',
      sessionId: 's-1',
      options: expect.objectContaining({ currentModelId: 'grok-4-fast' }),
    });
  });

  it('keeps an effort pick when session/backend-set succeeds without live options', async () => {
    const request = vi.fn().mockResolvedValue({ success: true, data: {} });
    const dispatch = vi.fn();
    mount({
      hostClient: { request } as unknown as HostClient,
      dispatch,
      sessionId: 's-1',
      optionsBySession: { 's-1': options({ currentEffortId: 'low' }) },
    });

    act(() => latest?.selectEffort('high'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'session/backend-updated',
      sessionId: 's-1',
      options: expect.objectContaining({ currentEffortId: 'high' }),
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
      options: expect.objectContaining({ currentModeId: 'plan', modeConfirmed: true }),
    });
  });

  it('does not let a late no-options completion reintroduce earlier model or effort choices', async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const request = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const dispatch = vi.fn();
    const initial = options({ currentModelId: 'grok-4', currentEffortId: 'low' });
    const args = {
      hostClient: { request } as unknown as HostClient,
      dispatch,
      sessionId: 's-1',
      optionsBySession: { 's-1': initial },
    };
    mount(args);

    act(() => latest?.selectModel('grok-4-fast'));
    mount({
      ...args,
      optionsBySession: { 's-1': { ...initial, currentModelId: 'grok-4-fast' } },
    });
    act(() => latest?.selectEffort('high'));
    mount({
      ...args,
      optionsBySession: {
        's-1': { ...initial, currentModelId: 'grok-4-fast', currentEffortId: 'high' },
      },
    });

    await act(async () => {
      resolvers[1]?.({ success: true, data: {} });
      await Promise.resolve();
    });
    await act(async () => {
      resolvers[0]?.({ success: true, data: {} });
      await Promise.resolve();
    });

    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'session/backend-updated',
      sessionId: 's-1',
      options: expect.objectContaining({
        currentModelId: 'grok-4-fast',
        currentEffortId: 'high',
      }),
    });
  });

  it('keeps a later model and effort when a pending mode settles without live options', async () => {
    let resolveMode: (value: unknown) => void = () => {};
    const request = vi.fn().mockImplementation((command: { modeId?: string }) => {
      if (command.modeId) {
        return new Promise((resolve) => {
          resolveMode = resolve;
        });
      }
      return Promise.resolve({ success: true, data: {} });
    });
    const store = mountStore({
      hostClient: { request } as unknown as HostClient,
      sessionId: 's-1',
      optionsBySession: {
        's-1': options({ currentModelId: 'grok-4', currentEffortId: 'low', currentModeId: 'default' }),
      },
    });

    act(() => latest?.selectMode('plan'));
    act(() => latest?.selectModel('grok-4-fast'));
    act(() => latest?.selectEffort('high'));
    await act(async () => {
      resolveMode({ success: true, data: {} });
      await Promise.resolve();
    });

    expect(store.optionsBySession()['s-1']).toEqual(
      expect.objectContaining({
        currentModelId: 'grok-4-fast',
        currentEffortId: 'high',
        currentModeId: 'plan',
        modeConfirmed: true,
      }),
    );
  });

  it('does not let an older no-options mode success confirm or replace a newer mode', async () => {
    const resolvers = new Map<string, (value: unknown) => void>();
    const request = vi.fn().mockImplementation((command: { modeId?: string }) => {
      return new Promise((resolve) => {
        if (command.modeId) resolvers.set(command.modeId, resolve);
      });
    });
    const store = mountStore({
      hostClient: { request } as unknown as HostClient,
      sessionId: 's-1',
      optionsBySession: {
        's-1': options({
          modes: [
            { id: 'default', label: 'Default' },
            { id: 'plan', label: 'Plan' },
            { id: 'build', label: 'Build' },
          ],
        }),
      },
    });

    act(() => latest?.selectMode('plan'));
    act(() => latest?.selectMode('build'));
    await act(async () => {
      resolvers.get('plan')?.({ success: true, data: {} });
      await Promise.resolve();
    });

    expect(store.optionsBySession()['s-1']).toEqual(
      expect.objectContaining({ currentModeId: 'build', modeConfirmed: false }),
    );

    await act(async () => {
      resolvers.get('build')?.({ success: true, data: {} });
      await Promise.resolve();
    });
    expect(store.optionsBySession()['s-1']).toEqual(
      expect.objectContaining({ currentModeId: 'build', modeConfirmed: true }),
    );
  });

  it('settles only the original session when a mode callback completes after a pane switch', async () => {
    let resolveMode: (value: unknown) => void = () => {};
    const request = vi.fn().mockImplementation((command: { modeId?: string }) => {
      if (command.modeId) {
        return new Promise((resolve) => {
          resolveMode = resolve;
        });
      }
      return Promise.resolve({ success: true, data: {} });
    });
    const original = options({ currentModelId: 'grok-4', currentModeId: 'default' });
    const other = options({ currentModelId: 'grok-4-fast', currentModeId: 'default', modeConfirmed: true });
    const store = mountStore({
      hostClient: { request } as unknown as HostClient,
      sessionId: 's-1',
      optionsBySession: { 's-1': original, 's-2': other },
    });

    act(() => latest?.selectMode('plan'));
    act(() => store.setSessionId('s-2'));
    act(() => latest?.selectModel('grok-4.7'));
    await act(async () => {
      resolveMode({ success: true, data: {} });
      await Promise.resolve();
    });

    expect(store.dispatches.filter((action) => action.type === 'session/backend-updated' && action.sessionId === 's-2')).toEqual([
      expect.objectContaining({
        options: expect.objectContaining({ currentModelId: 'grok-4.7', currentModeId: 'default' }),
      }),
    ]);
    expect(store.optionsBySession()['s-2']).toEqual(
      expect.objectContaining({ currentModelId: 'grok-4.7', currentModeId: 'default', modeConfirmed: true }),
    );
    expect(store.optionsBySession()['s-1']).toEqual(
      expect.objectContaining({ currentModelId: 'grok-4', currentModeId: 'plan', modeConfirmed: true }),
    );
  });

  it('does not resurrect a removed session when its no-options mode callback completes', async () => {
    let resolveMode: (value: unknown) => void = () => {};
    const request = vi.fn().mockImplementation(() => {
      return new Promise((resolve) => {
        resolveMode = resolve;
      });
    });
    const other = options({ currentModelId: 'grok-4-fast' });
    const store = mountStore({
      hostClient: { request } as unknown as HostClient,
      sessionId: 's-1',
      optionsBySession: { 's-1': options(), 's-2': other },
    });

    act(() => latest?.selectMode('plan'));
    act(() => {
      store.setOptionsBySession({ 's-2': other });
      store.setSessionId('s-2');
    });
    await act(async () => {
      resolveMode({ success: true, data: {} });
      await Promise.resolve();
    });

    expect(store.optionsBySession()['s-1']).toBeUndefined();
    expect(store.optionsBySession()['s-2']).toBe(other);
    expect(
      store.dispatches.filter((action) => action.type === 'session/backend-updated' && action.sessionId === 's-1'),
    ).toHaveLength(1);
  });

  it('preserves exact live catalog removals when a pending mode later settles without options', async () => {
    let resolveMode: (value: unknown) => void = () => {};
    let resolveModel: (value: unknown) => void = () => {};
    const request = vi.fn().mockImplementation((command: { modeId?: string; modelId?: string }) => {
      if (command.modeId) {
        return new Promise((resolve) => {
          resolveMode = resolve;
        });
      }
      return new Promise((resolve) => {
        resolveModel = resolve;
      });
    });
    const live: SessionBackendOptions = {
      agentId: 'grok',
      models: [{ id: 'grok-4-fast', label: 'Grok 4 Fast', efforts: ['low'] }],
      currentModelId: 'grok-4-fast',
      modes: [
        { id: 'default', label: 'Default' },
        { id: 'plan', label: 'Plan' },
      ],
      currentModeId: 'plan',
      modeConfirmed: false,
      commands: [],
    };
    const store = mountStore({
      hostClient: { request } as unknown as HostClient,
      sessionId: 's-1',
      optionsBySession: {
        's-1': options({ currentEffortId: 'low', autoApprove: true, currentModeId: 'default' }),
      },
    });

    act(() => latest?.selectMode('plan'));
    act(() => latest?.selectModel('grok-4-fast'));
    await act(async () => {
      resolveModel({ success: true, data: { options: live } });
      await Promise.resolve();
    });
    expect(store.dispatches.at(-1)).toEqual({
      type: 'session/backend-updated',
      sessionId: 's-1',
      options: live,
    });

    await act(async () => {
      resolveMode({ success: true, data: {} });
      await Promise.resolve();
    });
    const settled = store.optionsBySession()['s-1'];
    expect(settled).toEqual({ ...live, modeConfirmed: true });
    expect(settled).not.toHaveProperty('currentEffortId');
    expect(settled).not.toHaveProperty('autoApprove');
    expect(settled?.models).toEqual(live.models);
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

  it('hydrates a cold bound session from the Host catalog and saved choices', async () => {
    const catalog = options({
      models: [
        { id: 'grok-4', label: 'Grok 4', efforts: ['low', 'high'] },
        { id: 'grok-fast', label: 'Grok Fast', efforts: ['low', 'high'] },
      ],
    });
    const dispatch = vi.fn();
    mount({
      hostClient: { request: vi.fn().mockResolvedValue({ success: true, data: { agentId: 'grok' } }) } as unknown as HostClient,
      dispatch, sessionId: 'cold-grok', optionsBySession: {},
      sessionBackend: { agentId: 'grok', modelId: 'grok-fast', effortId: 'high', modeId: 'plan' },
      externalAgents: [statusFor(catalog)],
    });
    await act(async () => { await Promise.resolve(); });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'session/backend-hydrated', sessionId: 'cold-grok',
      options: expect.objectContaining({
        currentModelId: 'grok-fast', currentEffortId: 'high', currentModeId: 'plan', modeConfirmed: false,
      }),
    });
  });

  it('hydrates when the Host catalog arrives after the first empty session reply', async () => {
    const request = vi.fn().mockResolvedValue({ success: true, data: { agentId: 'grok' } });
    const dispatch = vi.fn();
    const args = {
      hostClient: { request } as unknown as HostClient,
      dispatch, sessionId: 'cold-grok', optionsBySession: {},
      sessionBackend: { agentId: 'grok' },
    };
    mount(args);
    await act(async () => { await Promise.resolve(); });
    expect(dispatch).not.toHaveBeenCalled();
    mount({ ...args, externalAgents: [statusFor(options())] });
    await act(async () => { await Promise.resolve(); });

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session/backend-hydrated', sessionId: 'cold-grok',
      options: expect.objectContaining({ agentId: 'grok', currentModelId: 'grok-4', modeConfirmed: false }),
    }));
  });

  it.each([
    { name: 'Pi session', binding: { agentId: 'pi' }, response: { success: true, data: { agentId: 'pi' } } },
    { name: 'mismatched session identity', binding: { agentId: 'grok' }, response: { success: true, data: { agentId: 'pi' } } },
    { name: 'failed request', binding: { agentId: 'grok' }, response: { success: false, error: 'unavailable' } },
  ])('does not use the Grok catalog for a $name', async ({ binding, response }) => {
    const dispatch = vi.fn();
    mount({
      hostClient: { request: vi.fn().mockResolvedValue(response) } as unknown as HostClient,
      dispatch, sessionId: 'session-1', optionsBySession: {},
      sessionBackend: binding, externalAgents: [statusFor(options())],
    });
    await act(async () => { await Promise.resolve(); });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects a mismatched catalog even when its status claims the bound agent', async () => {
    const dispatch = vi.fn();
    mount({
      hostClient: { request: vi.fn().mockResolvedValue({ success: true, data: { agentId: 'grok' } }) } as unknown as HostClient,
      dispatch, sessionId: 'session-1', optionsBySession: {}, sessionBackend: { agentId: 'grok' },
      externalAgents: [{ ...statusFor(options({ agentId: 'other-agent' })), agentId: 'grok' }],
    });
    await act(async () => { await Promise.resolve(); });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('ignores a late cold hydration reply after switching to a Pi session', async () => {
    let resolveOld: (value: unknown) => void = () => {};
    const request = vi.fn().mockImplementation((command: { sessionId?: string }) => {
      if (command.sessionId === 'old-grok') {
        return new Promise((resolve) => { resolveOld = resolve; });
      }
      return Promise.resolve({ success: true, data: { agentId: 'pi' } });
    });
    const dispatch = vi.fn();
    const args = { hostClient: { request } as unknown as HostClient, dispatch,
      optionsBySession: {}, externalAgents: [statusFor(options())] };
    mount({ ...args, sessionId: 'old-grok', sessionBackend: { agentId: 'grok' } });
    mount({ ...args, sessionId: 'new-pi', sessionBackend: { agentId: 'pi' } });
    await act(async () => {
      resolveOld({ success: true, data: { agentId: 'grok' } });
      await Promise.resolve();
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('prefers live session options over the cold Host catalog', async () => {
    const live = options({ currentModelId: 'live-model', modeConfirmed: true });
    const dispatch = vi.fn();
    mount({
      hostClient: { request: vi.fn().mockResolvedValue({ success: true, data: { agentId: 'grok', options: live } }) } as unknown as HostClient,
      dispatch, sessionId: 'session-1', optionsBySession: {},
      sessionBackend: { agentId: 'grok' }, externalAgents: [statusFor(options())],
    });
    await act(async () => { await Promise.resolve(); });
    expect(dispatch).toHaveBeenCalledWith({ type: 'session/backend-hydrated', sessionId: 'session-1', options: live });
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
    const request = vi.fn().mockResolvedValue({ success: true, data: { agents: [] } });
    mount({
      hostClient: { request } as unknown as HostClient,
      dispatch: vi.fn(),
      sessionId: 's-1',
      optionsBySession: { 's-1': options() },
    });
    expect(request).not.toHaveBeenCalled();
  });

  describe('draft session controls', () => {
    it('resolves options from externalAgents for clean slate draft', () => {
      const grokOptions = options({
        agentId: 'grok',
        models: [
          { id: 'grok-4.7', label: 'Grok 4.7', efforts: ['low', 'high'] },
          { id: 'grok-4.7-fast', label: 'Grok 4.7 Fast', efforts: ['low', 'high'] },
        ],
        currentModelId: 'grok-4.7-fast',
        currentEffortId: 'high',
      });
      mount({
        hostClient: {
          request: vi.fn().mockResolvedValue({ success: true, data: { agents: [] } }),
        } as unknown as HostClient,
        dispatch: vi.fn(),
        sessionId: null,
        optionsBySession: {},
        draftAgentId: 'grok',
        externalAgents: [
          {
            agentId: 'grok',
            state: 'ready',
            binaryPath: '/path/grok',
            version: '1.0',
            supportStatus: 'verified',
            options: grokOptions,
            checkedAt: new Date().toISOString(),
          },
        ],
      });

      expect(latest?.options).not.toBeNull();
      expect(latest?.options?.agentId).toBe('grok');
      expect(latest?.options?.currentModelId).toBe('grok-4.7-fast');
      expect(latest?.options?.currentEffortId).toBe('high');
      expect(latest?.draftBackendModelId).toBe('grok-4.7-fast');
      expect(latest?.draftBackendEffortId).toBe('high');
      expect(latest?.options?.models.map((m) => m.id)).toEqual(['grok-4.7', 'grok-4.7-fast']);
    });

    it('stays null when draftAgentId is pi', () => {
      mount({
        hostClient: {
          request: vi.fn().mockResolvedValue({ success: true, data: { agents: [] } }),
        } as unknown as HostClient,
        dispatch: vi.fn(),
        sessionId: null,
        optionsBySession: {},
        draftAgentId: 'pi',
      });

      expect(latest?.options).toBeNull();
      expect(latest?.draftBackendModelId).toBeUndefined();
      expect(latest?.draftBackendEffortId).toBeUndefined();
    });

    it('stays null when agent options are not yet reported', () => {
      mount({
        hostClient: {
          request: vi.fn().mockResolvedValue({ success: true, data: { agents: [] } }),
        } as unknown as HostClient,
        dispatch: vi.fn(),
        sessionId: null,
        optionsBySession: {},
        draftAgentId: 'grok',
        externalAgents: [],
      });

      expect(latest?.options).toBeNull();
      expect(latest?.draftBackendModelId).toBeUndefined();
      expect(latest?.draftBackendEffortId).toBeUndefined();
    });

    it('allows switching model on draft without calling backend-set', () => {
      const grokOptions = options({
        agentId: 'grok',
        models: [
          { id: 'grok-4.7', label: 'Grok 4.7', efforts: ['low', 'high'] },
          { id: 'grok-4.7-fast', label: 'Grok 4.7 Fast', efforts: ['low', 'high'] },
        ],
        currentModelId: 'grok-4.7-fast',
      });
      const request = vi.fn().mockResolvedValue({ success: true, data: { agents: [] } });
      mount({
        hostClient: { request } as unknown as HostClient,
        dispatch: vi.fn(),
        sessionId: null,
        optionsBySession: { prev: grokOptions },
        draftAgentId: 'grok',
        externalAgents: [statusFor(grokOptions)],
      });

      expect(latest?.options?.currentModelId).toBe('grok-4.7-fast');

      act(() => latest?.selectModel('grok-4.7'));

      expect(latest?.options?.currentModelId).toBe('grok-4.7');
      expect(latest?.draftBackendModelId).toBe('grok-4.7');
      expect(request).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'session/backend-set' }),
      );
    });

    it('allows switching effort on draft without calling backend-set', () => {
      const grokOptions = options({
        agentId: 'grok',
        models: [{ id: 'grok-4.7', label: 'Grok 4.7', efforts: ['low', 'high'] }],
        currentModelId: 'grok-4.7',
        currentEffortId: 'low',
      });
      const request = vi.fn().mockResolvedValue({ success: true, data: { agents: [] } });
      mount({
        hostClient: { request } as unknown as HostClient,
        dispatch: vi.fn(),
        sessionId: null,
        optionsBySession: { prev: grokOptions },
        draftAgentId: 'grok',
        externalAgents: [statusFor(grokOptions)],
      });

      expect(latest?.options?.currentEffortId).toBe('low');

      act(() => latest?.selectEffort('high'));

      expect(latest?.options?.currentEffortId).toBe('high');
      expect(latest?.draftBackendEffortId).toBe('high');
      expect(request).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'session/backend-set' }),
      );
    });

    it('waits for agent configuration instead of adopting an old session', () => {
      const customOptions = options({
        agentId: 'grok',
        models: [{ id: 'custom-grok', label: 'Custom Grok', efforts: ['low'] }],
        currentModelId: 'custom-grok',
      });
      mount({
        hostClient: {
          request: vi.fn().mockResolvedValue({ success: true, data: { agents: [] } }),
        } as unknown as HostClient,
        dispatch: vi.fn(),
        sessionId: null,
        optionsBySession: { 'prev-session': customOptions },
        draftAgentId: 'grok',
      });

      expect(latest?.options).toBeNull();
      expect(latest?.draftBackendModelId).toBeUndefined();
    });

    it('uses the current four-model catalog even with old 500K sessions cached', () => {
      const current = options({
        models: ['grok-4.7', 'grok-4.7-build-fast', 'grok-4.6', 'grok-4.5'].map((id) => ({
          id,
          label: id,
          contextTokens: 256000,
          efforts: ['high', 'low'],
        })),
        currentModelId: 'grok-4.7-build-fast',
        currentEffortId: 'high',
      });
      const old = options({
        models: ['grok-4.6', 'grok-4.5'].map((id) => ({ id, label: id, contextTokens: 500000 })),
        currentModelId: 'grok-4.6',
      });
      mount({
        hostClient: {
          request: vi.fn().mockResolvedValue({ success: true, data: { agents: [] } }),
        } as unknown as HostClient,
        dispatch: vi.fn(),
        sessionId: null,
        draftAgentId: 'grok',
        optionsBySession: { old },
        externalAgents: [statusFor(current)],
      });
      expect(latest?.options?.models).toEqual(current.models);
      expect(latest?.draftBackendModelId).toBe('grok-4.7-build-fast');
      expect(latest?.draftBackendEffortId).toBe('high');
    });

    it('refreshes defaults while retaining valid manual choices in the same draft', () => {
      const current = options({
        models: [
          { id: 'grok-4.7', label: 'Grok 4.7', efforts: ['low', 'high'] },
          { id: 'grok-4.7-build-fast', label: 'Grok 4.7 Fast', efforts: ['low', 'high'] },
        ],
        currentModelId: 'grok-4.7',
      });
      const args = {
        hostClient: {
          request: vi.fn().mockResolvedValue({ success: true, data: { agents: [] } }),
        } as unknown as HostClient,
        dispatch: vi.fn(),
        sessionId: null,
        draftAgentId: 'grok',
        optionsBySession: {},
        externalAgents: [statusFor(current)],
      };
      mount(args);
      const refreshed = {
        ...current,
        currentModelId: 'grok-4.7-build-fast',
        currentEffortId: 'high',
      };
      mount({ ...args, externalAgents: [statusFor(refreshed)] });
      expect(latest?.draftBackendModelId).toBe('grok-4.7-build-fast');
      act(() => {
        latest?.selectModel('grok-4.7');
        latest?.selectEffort('low');
        latest?.selectMode('plan');
      });
      mount({
        ...args,
        externalAgents: [
          statusFor({
            ...refreshed,
            models: refreshed.models.map((model) => ({ ...model, contextTokens: 256000 })),
          }),
        ],
      });
      expect(latest?.draftBackendModelId).toBe('grok-4.7');
      expect(latest?.draftBackendEffortId).toBe('low');
      expect(latest?.options?.currentModeId).toBe('plan');
    });

    it('clears removed overrides and does not resurrect them when a model returns', () => {
      const current = options({
        models: [
          { id: 'grok-4.7', label: 'Grok 4.7', efforts: ['low', 'high'] },
          { id: 'grok-4.6', label: 'Grok 4.6', efforts: ['low', 'high'] },
        ],
        currentModelId: 'grok-4.7',
        currentEffortId: 'high',
      });
      const args = {
        hostClient: {
          request: vi.fn().mockResolvedValue({ success: true, data: { agents: [] } }),
        } as unknown as HostClient,
        dispatch: vi.fn(),
        sessionId: null,
        draftAgentId: 'grok',
        optionsBySession: {},
        externalAgents: [statusFor(current)],
      };
      mount(args);
      act(() => {
        latest?.selectModel('grok-4.6');
        latest?.selectEffort('low');
        latest?.selectMode('plan');
      });
      mount({
        ...args,
        externalAgents: [
          statusFor({
            ...current,
            models: [{ id: 'grok-4.7', label: 'Grok 4.7' }],
            modes: [{ id: 'default', label: 'Default' }],
          }),
        ],
      });
      expect(latest?.draftBackendModelId).toBe('grok-4.7');
      expect(latest?.draftBackendEffortId).toBeUndefined();
      expect(latest?.options?.currentEffortId).toBeUndefined();
      expect(latest?.options?.currentModeId).toBe('default');
      mount(args);
      expect(latest?.draftBackendModelId).toBe('grok-4.7');
      expect(latest?.draftBackendEffortId).toBe('high');
      expect(latest?.options?.currentModeId).toBe('default');
    });

    it('resets choices for the next draft without changing existing sessions', () => {
      const current = options({
        models: [
          { id: 'grok-4.7', label: 'Grok 4.7', efforts: ['low', 'high'] },
          { id: 'grok-4.6', label: 'Grok 4.6', efforts: ['low', 'high'] },
        ],
        currentModelId: 'grok-4.7',
        currentEffortId: 'high',
      });
      const old = options({ currentModelId: 'grok-4.6' });
      const args = {
        hostClient: {
          request: vi.fn().mockResolvedValue({ success: true, data: { agents: [] } }),
        } as unknown as HostClient,
        dispatch: vi.fn(),
        sessionId: null,
        draftAgentId: 'grok',
        optionsBySession: { old },
        externalAgents: [statusFor(current)],
      };
      mount(args);
      act(() => {
        latest?.selectModel('grok-4.6');
        latest?.selectEffort('low');
      });
      act(() => latest?.clearDraftSelections());
      expect(latest?.draftBackendModelId).toBe('grok-4.7');
      expect(latest?.draftBackendEffortId).toBe('high');
      mount({ ...args, sessionId: 'old' });
      expect(latest?.options).toBe(old);
      expect(latest?.draftBackendModelId).toBeUndefined();
    });

    it('hydrates Agent defaults from the targeted status response', async () => {
      const catalog = options({ currentEffortId: 'high' });
      const status = statusFor(catalog);
      const dispatch = vi.fn();
      const request = vi.fn().mockResolvedValue({ success: true, data: { agents: [status] } });
      mount({ hostClient: { request } as unknown as HostClient, dispatch,
        sessionId: null, draftAgentId: 'grok', optionsBySession: {} });
      await act(async () => { await Promise.resolve(); });
      expect(request).toHaveBeenCalledWith({ type: 'agents/status', agentId: 'grok' });
      expect(dispatch).toHaveBeenCalledWith({ type: 'agents/status-updated', status });
    });

    it('queries only the selected agent once per draft entry and ignores a late response after switching', async () => {
      let respond: ((value: unknown) => void) | undefined;
      const request = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            respond = resolve;
          }),
      );
      const dispatch = vi.fn();
      const args = {
        hostClient: { request } as unknown as HostClient,
        dispatch,
        sessionId: null,
        draftAgentId: 'grok',
        optionsBySession: {},
        externalAgents: [],
      };
      mount(args);
      mount({ ...args, externalAgents: [statusFor(options())] });
      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith({ type: 'agents/status', agentId: 'grok' });
      mount({ ...args, draftAgentId: 'pi' });
      await act(async () => {
        respond?.({ success: true, data: { agents: [statusFor(options())] } });
      });
      expect(dispatch).not.toHaveBeenCalled();
    });
  });
});
