// @vitest-environment happy-dom
/**
 * Multi-session terminal state (pure state, no PTY I/O in vitest).
 */

import { describe, expect, it, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useTerminalSessions, type TerminalSessionsApi } from './use-terminal-sessions';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let lastApi: TerminalSessionsApi | null = null;

function TestHarness(props: {
  projectPath: string | null;
  projectTrusted: boolean;
  enabled: boolean;
}): null {
  const api = useTerminalSessions(props.projectPath, props.projectTrusted, props.enabled);
  lastApi = api;
  return null;
}

function renderHarness(props: {
  projectPath: string | null;
  projectTrusted: boolean;
  enabled: boolean;
}): { root: Root; container: HTMLDivElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<TestHarness {...props} />);
  });
  return { root, container };
}

describe('useTerminalSessions', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root && container) {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
    root = undefined;
    container = undefined;
    lastApi = null;
  });

  it('creates an initial session when project is trusted and enabled', () => {
    const rendered = renderHarness({ projectPath: '/project', projectTrusted: true, enabled: true });
    root = rendered.root;
    container = rendered.container;

    expect(lastApi?.sessions.length).toBe(1);
    expect(lastApi?.activeSessionId).toBe(lastApi?.sessions[0]?.id ?? null);
    expect(lastApi?.sessions[0]?.name).toMatch(/^zsh \d/);
  });

  it('stays empty when not trusted or disabled', () => {
    const rendered = renderHarness({ projectPath: '/project', projectTrusted: false, enabled: true });
    root = rendered.root;
    container = rendered.container;

    expect(lastApi?.sessions.length).toBe(0);
    expect(lastApi?.activeSessionId).toBeNull();
  });

  it('adds and activates new sessions', () => {
    const rendered = renderHarness({ projectPath: '/project', projectTrusted: true, enabled: true });
    root = rendered.root;
    container = rendered.container;

    let firstId: string | undefined;
    act(() => {
      firstId = lastApi?.sessions[0]?.id;
      lastApi?.addSession();
    });

    expect(lastApi?.sessions.length).toBe(2);
    expect(lastApi?.activeSessionId).not.toBe(firstId);
    expect(lastApi?.sessions[1]?.name).toMatch(/^zsh \d/);
  });

  it('closes the active session and falls back to the previous one', () => {
    const rendered = renderHarness({ projectPath: '/project', projectTrusted: true, enabled: true });
    root = rendered.root;
    container = rendered.container;

    const firstId = lastApi?.sessions[0]?.id;
    let addedId: string | undefined;
    act(() => {
      addedId = lastApi?.addSession()?.id;
    });
    expect(addedId).toBeDefined();

    act(() => {
      if (addedId) {
        lastApi?.closeSession(addedId);
      }
    });

    expect(lastApi?.sessions.length).toBe(1);
    expect(lastApi?.activeSessionId).toBe(firstId);
  });

  it('updates session status and ptyId', () => {
    const rendered = renderHarness({ projectPath: '/project', projectTrusted: true, enabled: true });
    root = rendered.root;
    container = rendered.container;

    const id = lastApi?.sessions[0]?.id;
    if (!id) throw new Error('no session');

    act(() => {
      lastApi?.onSessionStatus(id, 'starting', null);
    });
    expect(lastApi?.sessions[0]?.status).toBe('starting');

    act(() => {
      lastApi?.onSessionStatus(id, 'open', 'pty-123');
    });
    expect(lastApi?.sessions[0]?.status).toBe('open');
    expect(lastApi?.sessions[0]?.ptyId).toBe('pty-123');

    act(() => {
      lastApi?.onSessionStatus(id, 'error', null, 'boom');
    });
    expect(lastApi?.sessions[0]?.status).toBe('error');
    expect(lastApi?.sessions[0]?.error).toBe('boom');
  });

  it('resets sessions when the project changes', () => {
    const rendered = renderHarness({ projectPath: '/project', projectTrusted: true, enabled: true });
    root = rendered.root;
    container = rendered.container;

    act(() => {
      lastApi?.addSession();
    });
    expect(lastApi?.sessions.length).toBe(2);

    act(() => {
      root?.render(<TestHarness projectPath="/other" projectTrusted={true} enabled={true} />);
    });

    expect(lastApi?.sessions.length).toBe(1);
    expect(lastApi?.sessions[0]?.projectPath).toBe('/other');
    expect(lastApi?.activeSessionId).toBe(lastApi?.sessions[0]?.id ?? null);
  });
});
