// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeView } from './view-commands.js';
import { useDockingWorkspace, type DockingWorkspaceController } from './use-docking-workspace.js';
import type { MovableToolKind } from './types.js';
import type { HostServerMessage } from '@piwin/contracts';
import type { HostClient } from '../../host/host-client.js';
import { createLiveSessionInventory } from '../live-session-inventory.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function mountController(onReveal: (kind: MovableToolKind) => void): {
  root: Root;
  current: () => DockingWorkspaceController;
} {
  let controller: DockingWorkspaceController | null = null;
  function Probe(): null {
    controller = useDockingWorkspace({ enabled: true, rightPanelOpen: false, onRevealRightTool: onReveal });
    return null;
  }
  const root = createRoot(document.createElement('div'));
  act(() => root.render(<Probe />));
  return {
    root,
    current: () => {
      if (!controller) throw new Error('controller not mounted');
      return controller;
    },
  };
}

describe('useDockingWorkspace right panel reveal', () => {
  let root: Root | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    window.localStorage.clear();
  });

  it('reveals only the current conversation browser while the right panel is open', () => {
    const listeners = new Set<(message: HostServerMessage) => void>();
    const hostClient = { updateSubscriptions: async () => undefined, subscribe: (listener: (message: HostServerMessage) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    } } as unknown as HostClient;
    const reveal = vi.fn();
    function Probe(props: { sessionId: string; open: boolean }): null {
      useDockingWorkspace({ enabled: true, hostClient, followSessionId: props.sessionId,
        rightPanelOpen: props.open, onRevealRightTool: reveal });
      return null;
    }
    root = createRoot(document.createElement('div'));
    const emit = (sessionId: string) => act(() => {
      for (const listener of listeners) listener({ type: 'browser/controller', owner: 'agent', sessionId, ts: 0 });
    });
    act(() => root?.render(<Probe sessionId="a" open />));
    emit('b');
    expect(reveal).not.toHaveBeenCalled();
    emit('a');
    expect(reveal).toHaveBeenLastCalledWith('browser');
    reveal.mockClear();
    act(() => root?.render(<Probe sessionId="b" open={false} />));
    emit('b');
    expect(reveal).not.toHaveBeenCalled();
    act(() => root?.render(<Probe sessionId="b" open />));
    emit('a');
    expect(reveal).not.toHaveBeenCalled();
    emit('b');
    expect(reveal).toHaveBeenCalledExactlyOnceWith('browser');
  });

  it('reveals tools opened into the right group, but not plain focus changes', () => {
    const onReveal = vi.fn();
    const mounted = mountController(onReveal);
    root = mounted.root;

    act(() => mounted.current().openToolView('canvas'));
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(onReveal).toHaveBeenLastCalledWith('canvas');

    act(() => mounted.current().openToolView('browser'));
    expect(onReveal).toHaveBeenLastCalledWith('browser');

    // Opening the browser again focuses the existing one: no second tab.
    act(() => mounted.current().openToolView('browser'));
    expect(Object.values(mounted.current().state.views).filter((view) => view.kind === 'browser')).toHaveLength(1);

    // Closing the browser refocuses the canvas tab: no reveal for that.
    const browserId = Object.values(mounted.current().state.views).find((view) => view.kind === 'browser')?.viewId;
    act(() => mounted.current().setState((state) => (browserId ? closeView(state, browserId) : state)));
    expect(onReveal).toHaveBeenCalledTimes(3);
  });

  it('keeps a closed Browser tab closed when the completed session continues pushing page state', () => {
    const listeners = new Set<(message: HostServerMessage) => void>();
    const hostClient = {
      updateSubscriptions: async () => undefined,
      subscribe: (listener: (message: HostServerMessage) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as unknown as HostClient;
    const reveal = vi.fn();
    let controller: DockingWorkspaceController | null = null;
    function Probe(): null {
      controller = useDockingWorkspace({ enabled: true, hostClient,
        followSessionId: 'completed-conversation', rightPanelOpen: true, onRevealRightTool: reveal });
      return null;
    }
    const current = (): DockingWorkspaceController => {
      if (!controller) throw new Error('controller not mounted');
      return controller;
    };
    const emit = (message: HostServerMessage): void => act(() => {
      for (const listener of listeners) listener(message);
    });
    const browserViews = () => Object.values(current().state.views).filter((view) => view.kind === 'browser');
    root = createRoot(document.createElement('div'));
    act(() => root?.render(<Probe />));
    act(() => current().openToolView('canvas'));
    emit({ type: 'browser/controller', owner: 'agent', reason: 'agent-write', sessionId: 'completed-conversation', ts: 1 });
    const browserId = browserViews()[0]?.viewId;
    if (!browserId) throw new Error('expected Browser tab');
    emit({ type: 'browser/controller', owner: 'idle', reason: 'run-terminal', sessionId: 'completed-conversation', ts: 2 });
    act(() => current().setState((state) => closeView(state, browserId)));
    const focusedAfterClose = current().state.focusedViewId;
    reveal.mockClear();

    for (let revision = 1; revision <= 3; revision += 1) {
      emit({ type: 'browser/state', sessionId: 'completed-conversation', ts: revision + 2,
        url: 'https://linux.do/t/topic/2904802', lifecycle: 'ready', documentRevision: revision });
    }
    expect(browserViews()).toHaveLength(0);
    expect(current().state.focusedViewId).toBe(focusedAfterClose);
    expect(reveal).not.toHaveBeenCalled();

    emit({ type: 'browser/controller', owner: 'agent', reason: 'mirror-start', sessionId: 'completed-conversation', ts: 6 });
    expect(browserViews()).toHaveLength(0);
    expect(reveal).not.toHaveBeenCalled();

    // A subsequent genuine agent browser operation still reveals the surface.
    emit({ type: 'browser/controller', owner: 'agent', reason: 'agent-write', sessionId: 'completed-conversation', ts: 7 });
    expect(browserViews()).toHaveLength(1);
    expect(reveal).toHaveBeenCalledExactlyOnceWith('browser');
  });
});

describe('useDockingWorkspace right tools follow the session', () => {
  let root: Root | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    window.localStorage.clear();
  });

  function mountFollowing(): {
    setSession: (sessionId: string | null) => void;
    current: () => DockingWorkspaceController;
  } {
    let controller: DockingWorkspaceController | null = null;
    function Probe(props: { sessionId: string | null }): null {
      controller = useDockingWorkspace({
        enabled: true,
        rightPanelOpen: true,
        followSessionId: props.sessionId,
      });
      return null;
    }
    const mountedRoot = createRoot(document.createElement('div'));
    root = mountedRoot;
    act(() => mountedRoot.render(<Probe sessionId="a" />));
    return {
      setSession: (sessionId) => act(() => mountedRoot.render(<Probe sessionId={sessionId} />)),
      current: () => {
        if (!controller) throw new Error('controller not mounted');
        return controller;
      },
    };
  }

  const toolKinds = (controller: DockingWorkspaceController): string[] =>
    Object.values(controller.state.views)
      .map((view) => view.kind)
      .sort();

  it('restores each session tools and lets a new session inherit the last layout', () => {
    const mounted = mountFollowing();
    act(() => mounted.current().openToolView('browser'));
    expect(toolKinds(mounted.current())).toEqual(['browser']);

    // Session b has no memory yet: it inherits a's browser, then diverges.
    mounted.setSession('b');
    expect(toolKinds(mounted.current())).toEqual(['browser']);
    const browserId = Object.values(mounted.current().state.views).find((view) => view.kind === 'browser')?.viewId;
    act(() => mounted.current().setState((state) => (browserId ? closeView(state, browserId) : state)));
    act(() => mounted.current().openToolView('changes'));
    expect(toolKinds(mounted.current())).toEqual(['changes']);

    mounted.setSession('a');
    expect(toolKinds(mounted.current())).toEqual(['browser']);

    mounted.setSession('b');
    expect(toolKinds(mounted.current())).toEqual(['changes']);

    // A draft keeps what is showing, and so does the session it becomes.
    mounted.setSession(null);
    mounted.setSession('c');
    expect(toolKinds(mounted.current())).toEqual(['changes']);
  });
});

describe('useDockingWorkspace live-session contribution', () => {
  let root: Root | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    window.localStorage.clear();
  });

  it('contributes stage sessions to the shared inventory instead of writing subscriptions', async () => {
    const updateSubscriptions = vi.fn(() => Promise.resolve());
    const hostClient = { updateSubscriptions } as unknown as HostClient;
    const inventory = createLiveSessionInventory();
    let controller: DockingWorkspaceController | null = null;
    function Probe(): null {
      controller = useDockingWorkspace({ enabled: true, hostClient, inventory });
      return null;
    }
    root = createRoot(document.createElement('div'));
    await act(async () => {
      root?.render(<Probe />);
      await Promise.resolve();
    });
    const current = (): DockingWorkspaceController => {
      if (!controller) throw new Error('controller not mounted');
      return controller;
    };

    act(() => current().openOrFocusSession('session-docked'));
    expect([...inventory.resolve().sessionIds]).toEqual(['session-docked']);
    // The hook itself never writes to the Host.
    expect(updateSubscriptions).not.toHaveBeenCalled();

    // Unmounting withdraws the contribution.
    await act(async () => {
      root?.unmount();
      await Promise.resolve();
    });
    root = undefined;
    expect([...inventory.resolve().sessionIds]).toEqual([]);
  });
});
