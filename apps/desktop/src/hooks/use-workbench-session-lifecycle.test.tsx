// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse, ProjectRecord, ProjectWorktreeListing } from '@piwin/contracts';
import type { HostClient } from '../host/host-client';
import { useWorkbenchSessionLifecycle } from './use-workbench-session-lifecycle.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const primary = '/tmp/repo-primary';
const linked = '/tmp/repo-linked';
function project(path: string): ProjectRecord {
  return { path, trust: 'trusted', lastOpenedAt: '2026-01-01', createdAt: '2026-01-01' };
}
function worktree(path: string): ProjectWorktreeListing {
  return { path, gitRepositoryId: 'repo1', branch: 'main', isPrimary: path === primary };
}
function deferred<T>() {
  let fulfill: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => { fulfill = resolve; });
  return { promise, resolve(value: T) { if (!fulfill) throw new Error('missing resolver'); fulfill(value); } };
}
function listResponse(paths: string[], worktreePaths = paths): HostResponse {
  return {
    type: 'response', command: 'project/list', success: true,
    data: { projects: paths.map(project), worktrees: worktreePaths.map(worktree) },
  };
}

describe('sidebar project removal lifecycle', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  afterEach(() => { act(() => root?.unmount()); container?.remove(); });

  async function setup(initialPaths = [primary, linked]) {
    let hostPaths = initialPaths;
    let hostWorktrees = [primary, linked];
    let nextList: ReturnType<typeof deferred<HostResponse>> | undefined;
    const removeGate = deferred<HostResponse>();
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'project/list') {
        if (nextList) { const gate = nextList; nextList = undefined; return gate.promise; }
        return listResponse(hostPaths, hostWorktrees);
      }
      if (command.type === 'project/remove') {
        const response = await removeGate.promise;
        if (response.success) {
          hostPaths = hostPaths.filter((path) => path !== linked);
          hostWorktrees = hostWorktrees.filter((path) => path !== linked);
        }
        return response;
      }
      return { type: 'response', command: command.type, success: true, data: {} };
    });
    const hostClient = { request, getTransport: () => 'mock' } as unknown as HostClient;
    let captured: ReturnType<typeof useWorkbenchSessionLifecycle> | undefined;
    const notifications = vi.fn();
    function Harness() {
      captured = useWorkbenchSessionLifecycle({
        hostClient, hostReady: true, projectPath: null, config: null,
        setConfig: vi.fn(), dispatch: vi.fn(), dispatchNotification: notifications,
        hydrateSessions: vi.fn(async () => undefined),
        handleOpenProject: vi.fn(async () => undefined), handleResumeSession: vi.fn(),
        showArchivedSessions: false, remoteCatchUpEpoch: 0,
        saveSettingsInOrder: vi.fn(async () => true),
      });
      return null;
    }
    container = document.createElement('div'); document.body.append(container);
    root = createRoot(container);
    await act(async () => { root?.render(<Harness />); });
    const latest = () => { if (!captured) throw new Error('hook not rendered'); return captured; };
    let removal: Promise<void> | undefined;
    return {
      latest, notifications,
      async startRemove() { await act(async () => { removal = latest().handleRemoveProjectFromSidebar(linked); }); },
      async finishRemove(success = true) {
        await act(async () => {
          removeGate.resolve(success
            ? { type: 'response', command: 'project/remove', success: true, data: { path: linked, removed: true } }
            : { type: 'response', command: 'project/remove', success: false, error: 'remove failed' });
          await removal;
        });
      },
      async refresh() { await act(async () => { window.dispatchEvent(new Event('focus')); }); },
      async startStaleList() {
        const gate = deferred<HostResponse>(); nextList = gate;
        await act(async () => { window.dispatchEvent(new Event('focus')); });
        return { async finish() { await act(async () => { gate.resolve(listResponse([primary, linked])); }); } };
      },
      reopen() { hostPaths = [primary, linked]; hostWorktrees = [primary, linked]; },
    };
  }

  it('keeps projects and worktrees hidden when a stale list resolves during removal', async () => {
    const state = await setup();
    const stale = await state.startStaleList();
    await state.startRemove();
    await stale.finish();
    expect(state.latest().recentProjects.map((item) => item.path)).toEqual([primary]);
    expect(state.latest().worktrees.map((item) => item.path)).toEqual([primary]);
    await state.finishRemove();
  });

  it('rejects a pre-commit list that resolves after successful removal', async () => {
    const state = await setup();
    const stale = await state.startStaleList();
    await state.startRemove();
    await state.finishRemove();
    await stale.finish();
    expect(state.latest().recentProjects.map((item) => item.path)).toEqual([primary]);
    expect(state.latest().worktrees.map((item) => item.path)).toEqual([primary]);
  });

  it('immediately hides an unregistered discovered worktree', async () => {
    const state = await setup([primary]);
    expect(state.latest().worktrees.map((item) => item.path)).toContain(linked);
    await state.startRemove();
    expect(state.latest().worktrees.map((item) => item.path)).toEqual([primary]);
    await state.finishRemove();
    await state.refresh();
    expect(state.latest().worktrees.map((item) => item.path)).toEqual([primary]);
  });

  it('re-filters an interleaved cached project update on successful removal', async () => {
    const state = await setup();
    await state.startRemove();
    act(() => { state.latest().setRecentProjects([project(primary), project(linked)]); });
    await state.finishRemove();
    expect(state.latest().recentProjects.map((item) => item.path)).toEqual([primary]);
  });

  it('restores only after an explicit reopen is confirmed by a fresh list', async () => {
    const state = await setup();
    await state.startRemove(); await state.finishRemove();
    await state.refresh();
    expect(state.latest().recentProjects.map((item) => item.path)).toEqual([primary]);
    state.reopen(); await state.refresh();
    expect(state.latest().recentProjects.map((item) => item.path)).toContain(linked);
    expect(state.latest().worktrees.map((item) => item.path)).toContain(linked);
  });

  it('restores rejected removes and surfaces the Host error', async () => {
    const state = await setup();
    await state.startRemove(); await state.finishRemove(false);
    expect(state.latest().recentProjects.map((item) => item.path)).toContain(linked);
    expect(state.latest().worktrees.map((item) => item.path)).toContain(linked);
    expect(state.notifications).toHaveBeenCalledTimes(1);
  });
});
