// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InkstoneHost, InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { InkstoneHostProvider } from '../host/inkstone-host-context.js';
import { InkstoneContext } from '../inkstone-context.js';
import { INITIAL_INKSTONE_STATE, inkstoneReducer, type InkstoneAction, type InkstoneState } from '../inkstone-state.js';
import { SessionsPage } from './sessions.js';
import type { MobileProjectList } from '../../hooks/mobile-project-list.js';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import { readProjectList } from '../../mobile-host-readers.js';
import { createMobileRemoteReadModelRefresher, type MobileRemoteReadModelContext } from '../../hooks/mobile-host-read-model.js';
import { writeSessionSnapshot, readSessionSnapshot } from '../../hooks/mobile-offline-cache.js';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
});

function fixture(options: { snapshot?: Partial<MobileProjectList>; offline?: boolean; disconnected?: boolean } = {}) {
  const projects: MobileProjectList['projects'] = [
    { projectId: 'primary', displayName: 'Repository', gitRepositoryId: 'repo', path: '/public/primary', currentBranch: 'main', isPrimaryWorktree: true },
    { projectId: 'linked', displayName: 'Linked', gitRepositoryId: 'repo', path: '/public/linked', currentBranch: 'feature', isPrimaryWorktree: false, workspaceAvailability: 'missing' },
    { projectId: 'unknown', displayName: 'Unknown', gitRepositoryId: 'repo' },
  ];
  const projectList: MobileProjectList = { status: 'ready', projects,
    worktrees: [{ gitRepositoryId: 'repo', path: '/public/discovered', branch: null, isPrimary: false }], ...options.snapshot };
  const select = vi.fn(async (_id: string) => {});
  const pin = vi.fn(async (_id: string, _pinned: boolean) => true);
  const request = vi.fn();
  const host = {
    connectionState: { kind: options.disconnected ? 'disconnected' : 'ready' },
    client: { supportsCommand: () => false, request }, projects: projectList.projects, projectList,
    sessions: [
      { sessionId: 'primary-session', projectId: 'primary', scope: 'project', name: 'Primary session' },
      { sessionId: 'linked-session', projectId: 'linked', scope: 'project', name: 'Missing session', pinned: true },
      { sessionId: 'unknown-session', projectId: 'unknown', scope: 'project', name: 'Unknown session' },
      { sessionId: 'general-session', scope: 'general', name: 'General conversation' },
    ], activityItems: [], handleSelectSession: select, handlePinSession: pin,
    handleDeleteSession: vi.fn(), loadMoreSessions: vi.fn(),
  } as unknown as InkstoneHost;
  let hostCtx: InkstoneHostContextValue = { host, onOpenConnection: vi.fn(),
    modelSelection: { providerId: undefined, modelId: undefined, thinkingLevel: undefined, select: vi.fn(), selectThinking: vi.fn() },
    ...(options.offline ? { offlineSnapshot: { savedAt: '2026-10-02T00:00:00Z' } } : {}),
  };
  let state: InkstoneState = { ...INITIAL_INKSTONE_STATE, sessionMode: 'agent' };
  const dispatch = vi.fn((action: InkstoneAction) => {
    state = inkstoneReducer(state, action);
    draw();
  });
  const draw = () => root.render(
    <InkstoneContext.Provider value={{ state, dispatch }}>
      <InkstoneHostProvider value={hostCtx}>
        {state.route === 'chat'
          ? <button type="button" onClick={() => dispatch({ type: 'navigate', route: 'sessions' })}>返回会话</button>
          : <SessionsPage />}
      </InkstoneHostProvider>
    </InkstoneContext.Provider>,
  );
  act(draw);
  return { select, pin, request, dispatch, host, draw, state: () => state,
    replaceContext: (next: InkstoneHostContextValue) => { hostCtx = next; act(draw); }, hostCtx };
}

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((item) => item.textContent?.includes(text));
  if (found === undefined) throw new Error(`Missing button: ${text}`);
  return found;
}

async function click(text: string): Promise<void> {
  await act(async () => { button(text).click(); });
}

describe('readonly public session navigation', () => {
  it('renders repository/checkout/branch/missing labels and a non-actionable discovered hint', async () => {
    const view = fixture();
    expect(container.querySelectorAll('.project-heading b')).toHaveLength(2); // pinned + one shared repository
    expect(container.textContent).toContain('主检出');
    expect(container.textContent).toContain('工作树');
    expect(container.textContent).toContain('分支 · main');
    expect(container.textContent).toContain('分支 · feature');
    const missing = [...container.querySelectorAll('button.session-open')].filter((row) => row.textContent?.includes('Missing session'));
    expect(missing).toHaveLength(1);
    expect(missing[0]?.textContent).toContain('检出目录缺失');
    const unknown = button('Unknown session');
    expect(unknown.textContent).not.toMatch(/分支|主检出|工作树|缺失/);
    const hint = [...container.querySelectorAll('.session-item')].find((row) => row.textContent?.includes('Host 已发现检出'));
    expect(hint?.textContent).toContain('/public/discovered');
    expect(hint?.textContent).not.toContain('分支');
    expect(hint?.querySelectorAll('button')).toHaveLength(0);
    await click('Missing session');
    expect(view.select).toHaveBeenCalledExactlyOnceWith('linked-session');
    expect(view.state().route).toBe('chat');
    expect(view.state().toast.message).toContain('历史仍可读取');
    expect(view.request).not.toHaveBeenCalled();
    expect(view.pin).not.toHaveBeenCalled();
  });

  it('preserves pin/filter/back-navigation without duplicating pinned sessions or making new actions', async () => {
    const view = fixture();
    act(() => view.dispatch({ type: 'session-filter', value: '置顶' }));
    expect(container.querySelectorAll('button.session-open')).toHaveLength(1);
    expect(container.textContent).not.toContain('/public/discovered');
    await click('Missing session');
    await click('返回会话');
    expect(view.state().sessionMode).toBe('agent');
    expect(view.state().sessionFilter).toBe('置顶');
    expect(container.querySelectorAll('button.session-open')).toHaveLength(1);
    await click('取消置顶');
    expect(view.pin).toHaveBeenCalledExactlyOnceWith('linked-session', true);
    expect(view.request).not.toHaveBeenCalled();
  });

  it('leaves chat flat with general sessions only, ignoring Agent filters and checkout hints', () => {
    const view = fixture();
    act(() => {
      view.dispatch({ type: 'session-filter', value: '置顶' });
      view.dispatch({ type: 'set-session-mode', mode: 'chat' });
    });
    expect(container.querySelectorAll('button.session-open')).toHaveLength(1);
    expect(container.textContent).toContain('General conversation');
    expect(container.querySelectorAll('.project-heading')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/分支|主检出|工作树|\/public/);
    expect(view.select).not.toHaveBeenCalled();
  });

  it.each([{ offline: true }, { disconnected: true }])('does not show disconnected/cache Git metadata as current (%j)', (options) => {
    const view = fixture(options);
    expect(container.textContent).not.toMatch(/分支|主检出|工作树|检出目录缺失|\/public/);
    expect(view.request).not.toHaveBeenCalled();
  });

  it('blocks opening the ID/name-only offline snapshot', async () => {
    const view = fixture({ offline: true });
    await click('Missing session');
    expect(view.select).not.toHaveBeenCalled();
    expect(view.state().route).toBe('sessions');
    expect(view.state().toast.message).toContain('连上 Host');
  });

  it.each([
    { snapshot: { gitWorkspacePending: true as const }, label: '检出信息尚未完整' },
    { snapshot: { status: 'loading' as const, projects: [] }, label: '正在读取 Host 项目列表' },
    { snapshot: { status: 'not-exposed' as const, projects: [] }, label: 'Host 未开放项目列表' },
    { snapshot: { status: 'error' as const, projects: [], error: 'Denied list' }, label: 'Denied list' },
  ])('labels public read state without inventing healthy checkouts ($label)', ({ snapshot, label }) => {
    fixture({ snapshot });
    expect(container.querySelector('[role="status"]')?.textContent).toContain(label);
    if ('status' in snapshot) {
      expect(container.textContent).not.toMatch(/分支|主检出|工作树|\/public/);
    }
  });

  it('distinguishes omitted checkout inventory from ready-empty inventory', () => {
    const view = fixture();
    delete view.host.projectList.worktrees;
    act(view.draw);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Host 未提供已发现检出信息');
    expect(container.textContent).not.toContain('/public/discovered');
    view.host.projectList.worktrees = [];
    act(view.draw);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('omits malformed/unavailable project metadata and uses the actual referenced ID', () => {
    fixture({ snapshot: { projects: [], worktrees: [] } });
    expect(container.textContent).toContain('primary');
    expect(container.textContent).toContain('Host 未提供项目信息');
    expect(container.textContent).not.toMatch(/主检出|工作树|分支/);
  });

  it('keeps the newer selection authoritative when older hydration resolves last', async () => {
    const view = fixture();
    let first: (() => void) | undefined;
    let second: (() => void) | undefined;
    view.select.mockImplementationOnce(() => new Promise<void>((done) => { first = done; }));
    view.select.mockImplementationOnce(() => new Promise<void>((done) => { second = done; }));
    act(() => button('Missing session').click());
    act(() => button('Primary session').click());
    await act(async () => { first?.(); });
    expect(view.state().route).toBe('sessions');
    await act(async () => { second?.(); });
    expect(view.state().route).toBe('chat');
    expect(view.state().toast.message).not.toContain('缺失');
    expect(view.dispatch.mock.calls.filter(([action]) => action.type === 'navigate')).toHaveLength(1);
  });

  it('does not navigate after disconnect/replacement or rejection while opening', async () => {
    const view = fixture();
    let resolve: (() => void) | undefined;
    view.select.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
    act(() => button('Primary session').click());
    view.replaceContext({ ...view.hostCtx, host: { ...view.host, connectionState: { kind: 'disconnected' } } });
    await act(async () => { resolve?.(); });
    expect(view.state().route).toBe('sessions');
    view.replaceContext(view.hostCtx);
    view.select.mockRejectedValueOnce(new Error('Resume rejected'));
    await click('Primary session');
    expect(view.state().route).toBe('sessions');
    expect(view.state().toast.message).toBe('Resume rejected');
  });
});
function projectResponse(data: unknown): HostResponse {
  return { type: 'response', command: 'project/list', success: true, data };
}

const publicListing = {
  projects: [{ projectId: 'p', displayName: 'Repo', gitRepositoryId: 'repo', path: '/host/primary', isPrimaryWorktree: true }],
  worktrees: [{ gitRepositoryId: 'repo', path: '/host/unregistered', branch: null, isPrimary: false }],
  gitWorkspacePending: true,
};

describe('mobile public project-list snapshot', () => {
  it('reads discovered public checkouts/pending without inventing IDs or unknown branch facts', () => {
    expect(readProjectList(projectResponse(publicListing))).toEqual({ status: 'ready', ...publicListing });
    expect(readProjectList(projectResponse({ projects: [], worktrees: [] }))).toEqual({ status: 'ready', projects: [], worktrees: [] });
    expect(readProjectList(projectResponse({ projects: [] }))).toEqual({ status: 'ready', projects: [] });
    expect(readProjectList(undefined)).toEqual({ status: 'not-exposed', projects: [] });
  });

  it('strips malformed optional metadata and rejects malformed discovered rows, never coercing booleans', () => {
    const snapshot = readProjectList(projectResponse({
      projects: [null, { projectId: '' }, { projectId: 'p', displayName: '', gitRepositoryId: 12,
        currentBranch: null, isPrimaryWorktree: 'false', workspaceAvailability: 'healthy',
        isCheckoutRoot: false, secret: 'not public' }],
      worktrees: [null, { path: '/bad' }, { gitRepositoryId: 'repo', path: '/bad', branch: null, isPrimary: 'false' },
        { gitRepositoryId: 'repo', path: '', branch: 'main', isPrimary: true },
        { gitRepositoryId: 'repo', path: '/good', branch: '', isPrimary: true, lease: 'not public' }],
      gitWorkspacePending: 'true',
    }));
    expect(snapshot).toEqual({ status: 'ready', projects: [{ projectId: 'p', displayName: 'p', isCheckoutRoot: false }],
      worktrees: [{ gitRepositoryId: 'repo', path: '/good', branch: null, isPrimary: true }] });
    expect(readProjectList(projectResponse({ projects: null })).status).toBe('error');
    expect(readProjectList({ type: 'response', command: 'project/list', success: false, error: 'Denied' }))
      .toEqual({ status: 'error', projects: [], error: 'Denied' });
  });

  it('keeps the existing device snapshot ID/name-only, without paths or Git metadata', () => {
    const storage = new Map<string, string>();
    const adapter = { getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } };
    const snapshot = readProjectList(projectResponse(publicListing));
    writeSessionSnapshot(adapter, 'ws://test', [], snapshot.projects);
    expect(readSessionSnapshot(adapter, 'ws://test')?.projects).toEqual([{ projectId: 'p', displayName: 'Repo' }]);
    expect([...storage.values()].join('')).not.toMatch(/\/host|gitRepository|worktrees|gitWorkspacePending/);
  });
});

function refresherFixture(options: { supported?: boolean; list?: () => Promise<HostResponse> } = {}) {
  const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
    if (command.type === 'project/list') return options.list?.() ?? projectResponse(publicListing);
    return { type: 'response', command: command.type, success: true, data: { projects: [], sessions: [], items: [] } };
  });
  const client = { request, supportsCommand: () => options.supported !== false } as unknown as HostClient;
  const context: MobileRemoteReadModelContext = {
    clientRef: { current: client }, activeSessionRef: { current: undefined }, selectionGenerationRef: { current: 0 },
    setHostStatus: vi.fn(), setErrorMessage: vi.fn(), setProjectList: vi.fn(), setSessions: vi.fn(),
    setConfiguredModels: vi.fn(), setDefaultProviderId: vi.fn(), setDefaultModelId: vi.fn(), setActivityItems: vi.fn(),
    setArtifactEnabled: vi.fn(), setActiveSessionId: vi.fn(), setMessages: vi.fn(), setPausedCheckpointId: vi.fn(),
    beginSessionForeground: vi.fn(async () => {}),
  };
  return { client, request, context, refresh: createMobileRemoteReadModelRefresher(context) };
}

describe('existing mobile project/list refresh plumbing', () => {
  it('installs projects, inventory and pending from exactly one read, with no inventory/mutation command', async () => {
    const fixture = refresherFixture();
    await fixture.refresh(fixture.client);
    expect(fixture.request.mock.calls.map(([command]) => command.type))
      .toEqual(['host/status', 'project/list', 'session/list', 'models/configured', 'activity/summary', 'settings/get']);
    expect(fixture.context.setProjectList).toHaveBeenNthCalledWith(1, { status: 'loading', projects: [] });
    expect(fixture.context.setProjectList).toHaveBeenLastCalledWith({ status: 'ready', ...publicListing });
  });

  it('honors the public capability ceiling without a project request or perpetual loading', async () => {
    const fixture = refresherFixture({ supported: false });
    await fixture.refresh(fixture.client);
    expect(fixture.request.mock.calls.map(([command]) => command.type)).not.toContain('project/list');
    expect(fixture.context.setProjectList).toHaveBeenLastCalledWith({ status: 'not-exposed', projects: [] });
  });

  it('reports a rejected read and clears old project metadata', async () => {
    const fixture = refresherFixture({ list: async () => { throw new Error('Offline read'); } });
    await fixture.refresh(fixture.client);
    expect(fixture.context.setProjectList).toHaveBeenLastCalledWith({ status: 'error', projects: [], error: 'Offline read' });
  });

  it('cannot install a delayed snapshot after client replacement', async () => {
    let resolve: ((response: HostResponse) => void) | undefined;
    const fixture = refresherFixture({ list: () => new Promise((done) => { resolve = done; }) });
    const pending = fixture.refresh(fixture.client);
    fixture.context.clientRef.current = undefined;
    resolve?.(projectResponse(publicListing));
    await pending;
    expect(fixture.context.setProjectList).toHaveBeenCalledTimes(1); // only initial loading, not old Host data
  });
});
