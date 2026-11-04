// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeView } from './view-commands.js';
import { useDockingWorkspace, type DockingWorkspaceController } from './use-docking-workspace.js';
import type { MovableToolKind } from './types.js';
import type { HostServerMessage } from '@piwin/contracts';
import type { HostClient } from '../../host/host-client.js';

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
