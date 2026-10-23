// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useSyncSidebarModeForAgent } from './use-sync-sidebar-mode-for-agent';
import type { SidebarMode } from '../sidebar/sidebar-mode';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function Probe(props: {
  activeAgentId: string | undefined;
  setSidebarMode: (mode: SidebarMode) => void;
  activeScopeKind?: 'general' | 'project';
}): ReactElement {
  useSyncSidebarModeForAgent(props.activeAgentId, props.setSidebarMode, props.activeScopeKind);
  return <div />;
}

describe('useSyncSidebarModeForAgent', () => {
  let container: HTMLElement;
  let root: Root;
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('snaps to code when a project Grok session becomes active', () => {
    const setSidebarMode = vi.fn();
    act(() => {
      root.render(
        <Probe activeAgentId="pi" activeScopeKind="project" setSidebarMode={setSidebarMode} />,
      );
    });
    expect(setSidebarMode).not.toHaveBeenCalled();

    act(() => {
      root.render(
        <Probe activeAgentId="grok" activeScopeKind="project" setSidebarMode={setSidebarMode} />,
      );
    });
    expect(setSidebarMode).toHaveBeenCalledTimes(1);
    expect(setSidebarMode).toHaveBeenCalledWith('code');
  });

  it('snaps to chat when a Loose Grok session becomes active', () => {
    const setSidebarMode = vi.fn();
    act(() => {
      root.render(
        <Probe activeAgentId="grok" activeScopeKind="general" setSidebarMode={setSidebarMode} />,
      );
    });
    expect(setSidebarMode).toHaveBeenCalledWith('chat');
  });

  it('does not bounce to code when Chat is opened on an already-active project Grok session', () => {
    const setSidebarMode = vi.fn();
    act(() => {
      root.render(
        <Probe activeAgentId="grok" activeScopeKind="project" setSidebarMode={setSidebarMode} />,
      );
    });
    expect(setSidebarMode).toHaveBeenCalledWith('code');
    setSidebarMode.mockClear();

    // Parent re-render after the user clicks Chat — same Grok agent stays selected.
    act(() => {
      root.render(
        <Probe activeAgentId="grok" activeScopeKind="project" setSidebarMode={setSidebarMode} />,
      );
    });
    expect(setSidebarMode).not.toHaveBeenCalled();
  });

  it('does not snap when no session is active', () => {
    const setSidebarMode = vi.fn();
    act(() => {
      root.render(<Probe activeAgentId={undefined} setSidebarMode={setSidebarMode} />);
    });
    expect(setSidebarMode).not.toHaveBeenCalled();
  });
});
