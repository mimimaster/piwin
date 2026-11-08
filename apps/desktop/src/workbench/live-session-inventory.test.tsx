// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostClient } from '../host/host-client.js';
import type { LiveInterests } from '../host/host-client-remote-transport.js';
import {
  createLiveSessionInventory,
  useLiveSessionInventoryWriter,
  type LiveSessionInventory,
} from './live-session-inventory.js';
import { bindSideChat, resetSideChatBindingsForTests } from '../session/side-chat-sessions.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('createLiveSessionInventory', () => {
  it('resolves the deduped union of all contributors in key order', () => {
    const inventory = createLiveSessionInventory();
    inventory.setContribution('side-chats', ['s1']);
    inventory.setContribution('docking', ['a', 'b', 's1']);
    inventory.setContribution('panes', ['b', 'c']);

    // Keys sort 'docking' < 'panes' < 'side-chats'; first come first kept.
    expect(inventory.resolve()).toEqual({ sessionIds: ['a', 'b', 's1', 'c'], jobIds: [] });
  });

  it('replaces a contributor set instead of accumulating it', () => {
    const inventory = createLiveSessionInventory();
    inventory.setContribution('panes', ['a', 'b']);
    inventory.setContribution('panes', ['c']);
    expect(inventory.resolve()).toEqual({ sessionIds: ['c'], jobIds: [] });
  });

  it('drops a contributor on null', () => {
    const inventory = createLiveSessionInventory();
    inventory.setContribution('panes', ['a']);
    inventory.setContribution('docking', ['b']);
    inventory.setContribution('panes', null);
    expect(inventory.resolve()).toEqual({ sessionIds: ['b'], jobIds: [] });
    inventory.setContribution('docking', null);
    expect(inventory.resolve()).toEqual({ sessionIds: [], jobIds: [] });
  });

  it('caps the union at the configured maximum', () => {
    const inventory = createLiveSessionInventory(3);
    inventory.setContribution('docking', ['a', 'b', 'c', 'd']);
    inventory.setContribution('side-chats', ['e']);
    expect(inventory.resolve().sessionIds).toEqual(['a', 'b', 'c']);
  });

  it('fires onUnionChange only when the resolved union changes', () => {
    const changes: string[][] = [];
    const inventory = createLiveSessionInventory(8, (resolved) =>
      changes.push([...resolved.sessionIds]),
    );
    inventory.setContribution('panes', ['a', 'b']);
    // Same key, same ids → no notification.
    inventory.setContribution('panes', ['a', 'b']);
    // Another contributor adds only already-present ids → same union, silent.
    inventory.setContribution('docking', ['a']);
    inventory.setContribution('docking', ['a', 'c']);
    inventory.setContribution('docking', null);
    // 'docking' sorts before 'panes', so its ids take union order precedence.
    expect(changes).toEqual([['a', 'b'], ['a', 'c', 'b'], ['a', 'b']]);
  });
});

describe('setJobLogInterests', () => {
  it('carries job monitor ids alongside the session union without touching it', () => {
    const inventory = createLiveSessionInventory();
    inventory.setContribution('panes', ['a', 'b']);
    inventory.setJobLogInterests(['job-1']);
    expect(inventory.resolve()).toEqual({ sessionIds: ['a', 'b'], jobIds: ['job-1'] });

    // Contributor updates leave the job list alone; job updates leave the union alone.
    inventory.setContribution('docking', ['c']);
    expect(inventory.resolve()).toEqual({ sessionIds: ['c', 'a', 'b'], jobIds: ['job-1'] });
    inventory.setJobLogInterests(['job-2', 'job-3']);
    expect(inventory.resolve()).toEqual({ sessionIds: ['c', 'a', 'b'], jobIds: ['job-2', 'job-3'] });

    // null unsubscribes every monitor.
    inventory.setJobLogInterests(null);
    expect(inventory.resolve()).toEqual({ sessionIds: ['c', 'a', 'b'], jobIds: [] });
  });

  it('dedupes and caps job monitor ids at LIVE_JOB_LOG_MAX_IDS', () => {
    const inventory = createLiveSessionInventory();
    const ids = Array.from({ length: 20 }, (_, index) => `job-${index}`);
    ids.push('job-0');
    inventory.setJobLogInterests(ids);
    const resolved = inventory.resolve();
    expect(resolved.jobIds).toHaveLength(16);
    expect(resolved.jobIds[0]).toBe('job-0');
    expect(new Set(resolved.jobIds).size).toBe(16);
  });

  it('notifies on job interest changes and keeps job ids out of the session signature', () => {
    const changes: Array<{ sessions: string[]; jobs: string[] }> = [];
    const inventory = createLiveSessionInventory(8, (resolved) =>
      changes.push({ sessions: [...resolved.sessionIds], jobs: [...resolved.jobIds] }),
    );
    inventory.setJobLogInterests(['job-1']);
    inventory.setJobLogInterests(['job-1']); // same list → silent
    inventory.setContribution('panes', ['job-1']); // same id as a session stays distinct
    inventory.setJobLogInterests(null);
    expect(changes).toEqual([
      { sessions: [], jobs: ['job-1'] },
      { sessions: ['job-1'], jobs: ['job-1'] },
      { sessions: ['job-1'], jobs: [] },
    ]);
  });
});

describe('useLiveSessionInventoryWriter', () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    resetSideChatBindingsForTests();
  });

  const flushMicrotasks = async (): Promise<void> => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it('is the single writer: batches all contributors into one updateSubscriptions call', async () => {
    const updateSubscriptions = vi.fn<(interests: LiveInterests) => Promise<void>>(() =>
      Promise.resolve(),
    );
    const hostClient = { updateSubscriptions } as unknown as HostClient;
    let captured: { inventory: LiveSessionInventory } | null = null;
    function Probe(): null {
      captured = useLiveSessionInventoryWriter(hostClient);
      return null;
    }
    root = createRoot(document.createElement('div'));
    await act(async () => {
      root?.render(<Probe />);
    });
    if (!captured) throw new Error('writer not mounted');
    const inventory = (captured as { inventory: LiveSessionInventory }).inventory;

    // Several contributor updates in one commit collapse into one send.
    act(() => {
      inventory.setContribution('docking', ['a', 'b']);
      inventory.setContribution('panes', ['b', 'c']);
    });
    await flushMicrotasks();
    expect(updateSubscriptions).toHaveBeenCalledTimes(1);
    expect(updateSubscriptions).toHaveBeenLastCalledWith({
      sessionIds: ['a', 'b', 'c'],
      jobIds: [],
    });

    // A contribution that leaves the resolved union unchanged must not re-send.
    act(() => inventory.setContribution('monitor', ['a', 'b']));
    await flushMicrotasks();
    expect(updateSubscriptions).toHaveBeenCalledTimes(1);

    act(() => inventory.setContribution('panes', ['d']));
    await flushMicrotasks();
    expect(updateSubscriptions).toHaveBeenCalledTimes(2);
    expect(updateSubscriptions).toHaveBeenLastCalledWith({
      sessionIds: ['a', 'b', 'd'],
      jobIds: [],
    });
  });

  it('sends job log monitor interests through the same updateSubscriptions call', async () => {
    const updateSubscriptions = vi.fn<(interests: LiveInterests) => Promise<void>>(() =>
      Promise.resolve(),
    );
    const hostClient = { updateSubscriptions } as unknown as HostClient;
    let captured: { inventory: LiveSessionInventory } | null = null;
    function Probe(): null {
      captured = useLiveSessionInventoryWriter(hostClient);
      return null;
    }
    root = createRoot(document.createElement('div'));
    await act(async () => {
      root?.render(<Probe />);
    });
    if (!captured) throw new Error('writer not mounted');
    const inventory = (captured as { inventory: LiveSessionInventory }).inventory;

    // A jobIds-only first send must not be swallowed by the empty-union skip.
    act(() => inventory.setJobLogInterests(['job-1']));
    await flushMicrotasks();
    expect(updateSubscriptions).toHaveBeenCalledTimes(1);
    expect(updateSubscriptions).toHaveBeenLastCalledWith({
      sessionIds: [],
      jobIds: ['job-1'],
    });

    // Clearing the monitor resends with an empty list.
    act(() => inventory.setJobLogInterests(null));
    await flushMicrotasks();
    expect(updateSubscriptions).toHaveBeenCalledTimes(2);
    expect(updateSubscriptions).toHaveBeenLastCalledWith({
      sessionIds: [],
      jobIds: [],
    });
  });

  it('contributes right-panel side chats itself', async () => {
    const updateSubscriptions = vi.fn<(interests: LiveInterests) => Promise<void>>(() =>
      Promise.resolve(),
    );
    const hostClient = { updateSubscriptions } as unknown as HostClient;
    function Probe(): null {
      useLiveSessionInventoryWriter(hostClient);
      return null;
    }
    root = createRoot(document.createElement('div'));
    await act(async () => {
      root?.render(<Probe />);
    });

    act(() => {
      bindSideChat('main', 'chat', 'side-session-1');
    });
    await flushMicrotasks();
    expect(updateSubscriptions).toHaveBeenLastCalledWith({
      sessionIds: ['side-session-1'],
      jobIds: [],
    });
  });
});
