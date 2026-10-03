// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostPush, HostResponse, SessionPlan, PlanExecutionState } from '@piwin/contracts';
import type { HostClient, HostClientState } from '@piwin/host-client';
import { useSessionPlanTodo, planProgressLabel, type SessionPlanTodo } from './use-session-plan-todo.js';
import { InkstoneHostProvider, type InkstoneHost } from './inkstone-host-context.js';
import { InkstoneContext } from '../inkstone-context.js';
import { INITIAL_INKSTONE_STATE } from '../inkstone-state.js';
import { PlanPage } from '../pages/plan.js';

function plan(revision = 1, sessionId = 's1', execution?: PlanExecutionState): SessionPlan {
  return { id: 'plan-1', sessionId, projectPath: '/public/display-only', status: 'executing',
    title: 'Host plan', goal: 'Host goal', revision, source: 'user',
    createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z',
    steps: [{ id: 'step-1', title: 'One', status: revision > 1 ? 'done' : 'pending' },
      { id: 'step-2', title: 'Two', status: 'pending' }],
    ...(execution === undefined ? {} : { execution }) };
}
function execution(sessionId = 's1', status: PlanExecutionState['status'] = 'running'): PlanExecutionState {
  return { sessionId, planId: 'plan-1', mode: 'inline', status, childSessionIds: [], currentStepId: 'step-1' };
}
function deferred() {
  let resolve: (response: HostResponse) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<HostResponse>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function host(allowed = ['plan/get']) {
  let pushListener: ((value: HostPush) => void) | undefined;
  let stateListener: ((value: HostClientState) => void) | undefined;
  const calls: { command: HostCommand; pending: ReturnType<typeof deferred> }[] = [];
  const unsubscribePush = vi.fn();
  const unsubscribeState = vi.fn();
  const request = vi.fn((command: HostCommand) => {
    const pending = deferred(); calls.push({ command, pending }); return pending.promise;
  });
  const client = { request, supportsCommand: (type: string) => allowed.includes(type),
    subscribePush: (listener: (value: HostPush) => void) => { pushListener = listener; return unsubscribePush; },
    subscribeState: (listener: (value: HostClientState) => void) => { stateListener = listener; listener({ kind: 'ready' }); return unsubscribeState; },
  } as unknown as HostClient;
  const call = (index: number) => {
    const value = calls[index];
    if (value === undefined) throw new Error(`missing call ${index}`);
    return value;
  };
  return { client, request, calls, call, unsubscribePush, unsubscribeState,
    push: (value: HostPush) => pushListener?.(value), state: (value: HostClientState) => stateListener?.(value),
    resolvePlan: (index: number, value: SessionPlan | null) => call(index).pending.resolve({ type: 'response', command: 'plan/get', success: true, data: { plan: value } }) };
}

let root: Root;
let container: HTMLDivElement;
let latest: SessionPlanTodo | undefined;
function Probe({ client, sessionId = 's1' }: { client?: HostClient; sessionId?: string }) {
  latest = useSessionPlanTodo(client, sessionId); return null;
}
function live() {
  if (latest === undefined) throw new Error('missing probe');
  return latest;
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); latest = undefined; });

describe('Host plan/todo live reads', () => {
  it('initial slow get cannot overwrite plan/updated and lower revisions/foreign pushes are ignored', async () => {
    const h = host();
    act(() => root.render(<Probe client={h.client} />));
    act(() => { h.push({ type: 'plan/updated', sessionId: 'other', plan: plan(9, 'other') }); h.push({ type: 'plan/execution-updated', state: execution('other') }); });
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(live().plan).toBeNull();
    act(() => h.push({ type: 'plan/updated', sessionId: 's1', plan: plan(3) }));
    await act(async () => h.resolvePlan(0, plan(1)));
    expect(live().plan?.revision).toBe(3);
    act(() => h.push({ type: 'plan/updated', sessionId: 's1', plan: plan(2) }));
    expect(live().plan?.revision).toBe(3);
    expect(planProgressLabel(live().plan)).toBe('1/2');
  });

  it('execution pushes coalesce a capability-gated follow-up, invalidating older initial reads', async () => {
    const h = host();
    act(() => root.render(<Probe client={h.client} />));
    act(() => { h.push({ type: 'plan/execution-updated', state: execution() }); h.push({ type: 'plan/execution-updated', state: execution() }); });
    expect(h.request).toHaveBeenCalledTimes(1);
    await act(async () => h.resolvePlan(0, plan(1)));
    expect(live().plan).toBeNull();
    expect(h.request).toHaveBeenCalledTimes(2);
    expect(h.call(1).command).toEqual({ type: 'plan/get', sessionId: 's1' });
    await act(async () => h.resolvePlan(1, plan(2, 's1', execution())));
    expect(live().plan?.execution?.status).toBe('running');
  });

  it('manual refresh supersedes initial read and a pushed plan supersedes pending refresh', async () => {
    const h = host();
    act(() => root.render(<Probe client={h.client} />));
    act(() => { void live().refreshPlan(); });
    await act(async () => h.resolvePlan(0, plan(1)));
    expect(h.request).toHaveBeenCalledTimes(2);
    expect(live().plan).toBeNull();
    act(() => h.push({ type: 'plan/updated', sessionId: 's1', plan: plan(4) }));
    await act(async () => h.resolvePlan(1, plan(2)));
    expect(live().plan?.revision).toBe(4);
  });

  it('does not fake a plan or request unavailable plan/get on execution pushes', () => {
    const h = host([]);
    act(() => root.render(<Probe client={h.client} />));
    act(() => h.push({ type: 'plan/execution-updated', state: execution('s1', 'completed') }));
    expect(h.request).not.toHaveBeenCalled();
    expect(live().plan).toBeNull();
    expect(live().planLoaded).toBe(true);
    expect(live().planError).toContain('未开放');
  });

  it.each(['session', 'client'] as const)('old %s read/push cannot populate a new owner (including matching plan ID)', async (change) => {
    const h = host();
    const next = host();
    act(() => root.render(<Probe client={h.client} />));
    if (change === 'session') act(() => root.render(<Probe client={h.client} sessionId="s2" />));
    else act(() => root.render(<Probe client={next.client} />));
    const active = change === 'session' ? h : next;
    const index = change === 'session' ? 1 : 0;
    const sessionId = change === 'session' ? 's2' : 's1';
    await act(async () => active.resolvePlan(index, plan(2, sessionId)));
    await act(async () => h.resolvePlan(0, plan(9)));
    if (change === 'client') act(() => h.push({ type: 'plan/updated', sessionId: 's1', plan: plan(10) }));
    else act(() => h.push({ type: 'plan/execution-updated', state: execution('s1') }));
    expect(live().plan?.sessionId).toBe(sessionId);
    expect(live().plan?.revision).toBe(2);
    expect(h.unsubscribePush).toHaveBeenCalledTimes(1);
    expect(h.unsubscribeState).toHaveBeenCalledTimes(1);
    expect(active.calls).toHaveLength(change === 'session' ? 2 : 1);
  });

  it('session ABA selection cannot revive an older request for the same session', async () => {
    const h = host();
    act(() => root.render(<Probe client={h.client} />));
    act(() => root.render(<Probe client={h.client} sessionId="s2" />));
    act(() => root.render(<Probe client={h.client} />));
    await act(async () => h.resolvePlan(2, plan(3)));
    await act(async () => { h.resolvePlan(0, plan(9)); h.resolvePlan(1, plan(8, 's2')); });
    expect(live().plan?.revision).toBe(3);
    expect(h.unsubscribePush).toHaveBeenCalledTimes(2);
  });

  it('reconnect reads independently of old pending connection, clears stale data and unsubscribes on unmount', async () => {
    const h = host();
    act(() => root.render(<Probe client={h.client} />));
    act(() => h.push({ type: 'plan/updated', sessionId: 's1', plan: plan(2) }));
    act(() => h.state({ kind: 'disconnected' }));
    expect(live().plan).toBeNull();
    act(() => h.push({ type: 'plan/updated', sessionId: 's1', plan: plan(8) }));
    expect(live().plan).toBeNull();
    act(() => h.state({ kind: 'ready' }));
    expect(h.request).toHaveBeenCalledTimes(2);
    await act(async () => h.resolvePlan(1, plan(3)));
    await act(async () => h.resolvePlan(0, plan(9)));
    expect(live().plan?.revision).toBe(3);
    act(() => root.render(null));
    expect(h.unsubscribePush).toHaveBeenCalledTimes(1);
    expect(h.unsubscribeState).toHaveBeenCalledTimes(1);
    act(() => h.push({ type: 'plan/execution-updated', state: execution() }));
    expect(h.request).toHaveBeenCalledTimes(2);
  });

  it('initial todo read cannot overwrite a newer current push or accept foreign todos', async () => {
    const h = host(['plan/get', 'todo/get']);
    act(() => root.render(<Probe client={h.client} />));
    const item = { id: 't1', content: 'Host todo', status: 'done' as const };
    act(() => h.push({ type: 'todo/updated', sessionId: 's1', items: [item] }));
    await act(async () => h.call(1).pending.resolve({ type: 'response', command: 'todo/get', success: true, data: { items: [] } }));
    act(() => h.push({ type: 'todo/updated', sessionId: 'foreign', items: [] }));
    expect(live().todos).toEqual([item]);
    await act(async () => h.resolvePlan(0, null));
    expect(live().planLoaded).toBe(true);
  });

  it('late failure cannot mutate a new owner; current failed read remains retryable', async () => {
    const h = host();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    act(() => root.render(<Probe client={h.client} />));
    act(() => root.render(<Probe client={h.client} sessionId="s2" />));
    await act(async () => h.resolvePlan(1, plan(2, 's2')));
    await act(async () => h.call(0).pending.reject(new Error('old')));
    expect(live().planError).toBeUndefined();
    act(() => { void live().refreshPlan(); });
    await act(async () => h.call(2).pending.reject(new Error('retry me')));
    expect(live().planError).toBe('retry me');
    act(() => { void live().refreshPlan(); });
    await act(async () => h.resolvePlan(3, plan(3, 's2')));
    expect(live().planError).toBeUndefined();
    expect(live().plan?.revision).toBe(3);
    warn.mockRestore();
  });
});

function renderPane(client: HostClient, state: 'ready' | 'disconnected' = 'ready') {
  const inkstoneHost = { client, activeSessionId: 's1', connectionState: { kind: state } } as unknown as InkstoneHost;
  root.render(<InkstoneContext.Provider value={{ state: INITIAL_INKSTONE_STATE, dispatch: vi.fn() }}>
    <InkstoneHostProvider value={{ host: inkstoneHost, onOpenConnection: vi.fn(),
      modelSelection: { providerId: undefined, modelId: undefined, thinkingLevel: undefined, select: vi.fn(), selectThinking: vi.fn() } }}>
      <PlanPage />
    </InkstoneHostProvider>
  </InkstoneContext.Provider>);
}
describe('existing plan pane live display', () => {
  it('shows Host progress/execution updates and truthful unknown without a raw object or inferred completion', async () => {
    const h = host();
    act(() => renderPane(h.client));
    expect(container.textContent).toContain('正在读取计划');
    await act(async () => h.resolvePlan(0, plan(1)));
    expect(container.textContent).toContain('0/2');
    expect(container.textContent).toContain('执行状态：Host 未公开');
    act(() => h.push({ type: 'plan/execution-updated', state: execution() }));
    await act(async () => h.resolvePlan(1, plan(2, 's1', execution())));
    expect(container.textContent).toContain('1/2');
    expect(container.textContent).toContain('执行状态：执行中');
    expect(container.textContent).not.toContain('currentStepId');
    expect(container.textContent).not.toContain('Walkthrough');
    act(() => h.push({ type: 'plan/updated', sessionId: 's1', plan: plan(3, 's1', execution('s1', 'failed')) }));
    expect(container.textContent).toContain('执行状态：执行失败');
    expect(h.calls.every(({ command }) => command.type === 'plan/get')).toBe(true);
  });

  it('read capability missing is explicit, not a spinner; connection label does not fake an empty plan', () => {
    const h = host([]);
    act(() => renderPane(h.client));
    expect(container.textContent).toContain('未开放计划读取');
    expect(container.textContent).not.toContain('正在读取计划');
    act(() => renderPane(h.client, 'disconnected'));
    expect(container.textContent).toContain('等待 Host 连接');
    expect(container.textContent).not.toContain('当前会话没有计划');
  });
});
