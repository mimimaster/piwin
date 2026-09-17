// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeView } from './view-commands.js';
import { useDockingWorkspace, type DockingWorkspaceController } from './use-docking-workspace.js';
import type { MovableToolKind } from './types.js';

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

  it('reveals tools opened into the right group, but not plain focus changes', () => {
    const onReveal = vi.fn();
    const mounted = mountController(onReveal);
    root = mounted.root;

    act(() => mounted.current().openToolView('canvas'));
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(onReveal).toHaveBeenLastCalledWith('canvas');

    act(() => mounted.current().openToolView('browser'));
    expect(onReveal).toHaveBeenLastCalledWith('browser');

    // Closing the browser refocuses the canvas tab: no reveal for that.
    const browserId = Object.values(mounted.current().state.views).find((view) => view.kind === 'browser')?.viewId;
    act(() => mounted.current().setState((state) => (browserId ? closeView(state, browserId) : state)));
    expect(onReveal).toHaveBeenCalledTimes(2);
  });
});
