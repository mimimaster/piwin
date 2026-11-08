// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostClient } from '../host/host-client.js';
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
    expect([...inventory.resolve()]).toEqual(['a', 'b', 's1', 'c']);
  });

  it('replaces a contributor set instead of accumulating it', () => {
    const inventory = createLiveSessionInventory();
    inventory.setContribution('panes', ['a', 'b']);
    inventory.setContribution('panes', ['c']);
    expect([...inventory.resolve()]).toEqual(['c']);
  });

  it('drops a contributor on null', () => {
    const inventory = createLiveSessionInventory();
    inventory.setContribution('panes', ['a']);
    inventory.setContribution('docking', ['b']);
    inventory.setContribution('panes', null);
    expect([...inventory.resolve()]).toEqual(['b']);
    inventory.setContribution('docking', null);
    expect([...inventory.resolve()]).toEqual([]);
  });

  it('caps the union at the configured maximum', () => {
    const inventory = createLiveSessionInventory(3);
    inventory.setContribution('docking', ['a', 'b', 'c', 'd']);
    inventory.setContribution('side-chats', ['e']);
    expect([...inventory.resolve()]).toEqual(['a', 'b', 'c']);
  });

  it('fires onUnionChange only when the resolved union changes', () => {
    const changes: string[][] = [];
    const inventory = createLiveSessionInventory(8, (resolved) => changes.push([...resolved]));
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
    const updateSubscriptions = vi.fn<(sessionIds: string[]) => Promise<void>>(() =>
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
    expect(updateSubscriptions).toHaveBeenLastCalledWith(['a', 'b', 'c']);

    // A contribution that leaves the resolved union unchanged must not re-send.
    act(() => inventory.setContribution('monitor', ['a', 'b']));
    await flushMicrotasks();
    expect(updateSubscriptions).toHaveBeenCalledTimes(1);

    act(() => inventory.setContribution('panes', ['d']));
    await flushMicrotasks();
    expect(updateSubscriptions).toHaveBeenCalledTimes(2);
    expect(updateSubscriptions).toHaveBeenLastCalledWith(['a', 'b', 'd']);
  });

  it('contributes right-panel side chats itself', async () => {
    const updateSubscriptions = vi.fn<(sessionIds: string[]) => Promise<void>>(() =>
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
    expect(updateSubscriptions).toHaveBeenLastCalledWith(['side-session-1']);
  });
});
