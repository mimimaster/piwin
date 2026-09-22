// @vitest-environment happy-dom
/**
 * Multi-session terminal state (pure state, no PTY I/O in vitest).
 * Now supports general-scope terminals (no project required).
 */

import { describe, expect, it, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  MAX_TERMINAL_SESSIONS,
  useTerminalSessions,
  type TerminalSessionsApi,
} from './use-terminal-sessions';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let lastApi: TerminalSessionsApi | null = null;

function TestHarness(props: {
  projectPath: string | null;
  projectTrusted: boolean;
  enabled: boolean;
  defaultCwd: string;
}): null {
  const api = useTerminalSessions(
    props.projectPath,
    props.projectTrusted,
    props.enabled,
    props.defaultCwd,
  );
  lastApi = api;
  return null;
}

function renderHarness(props: {
  projectPath: string | null;
  projectTrusted: boolean;
  enabled: boolean;
  defaultCwd: string;
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

  it('creates an initial session when enabled', () => {
    const rendered = renderHarness({
      projectPath: '/project',
      projectTrusted: true,
      enabled: true,
      defaultCwd: '/home',
    });
    root = rendered.root;
    container = rendered.container;

    expect(lastApi?.sessions.length).toBe(1);
    expect(lastApi?.activeSessionId).toBe(lastApi?.sessions[0]?.id ?? null);
    expect(lastApi?.sessions[0]?.name).toMatch(/^zsh\d+/);
    expect(lastApi?.sessions[0]?.cwd).toBe('/home');
  });

  it('creates initial session even without project or trust', () => {
    const rendered = renderHarness({
      projectPath: null,
      projectTrusted: false,
      enabled: true,
      defaultCwd: '/tmp',
    });
    root = rendered.root;
    container = rendered.container;

    expect(lastApi?.sessions.length).toBe(1);
    expect(lastApi?.sessions[0]?.cwd).toBe('/tmp');
    expect(lastApi?.sessions[0]?.projectPath).toBe('');
  });

  it('stays empty when disabled', () => {
    const rendered = renderHarness({
      projectPath: '/project',
      projectTrusted: true,
      enabled: false,
      defaultCwd: '/home',
    });
    root = rendered.root;
    container = rendered.container;

    expect(lastApi?.sessions.length).toBe(0);
    expect(lastApi?.activeSessionId).toBeNull();
  });

  it('adds and activates new sessions', () => {
    const rendered = renderHarness({
      projectPath: '/project',
      projectTrusted: true,
      enabled: true,
      defaultCwd: '/home',
    });
    root = rendered.root;
    container = rendered.container;

    let firstId: string | undefined;
    act(() => {
      firstId = lastApi?.sessions[0]?.id;
      lastApi?.addSession();
    });

    expect(lastApi?.sessions.length).toBe(2);
    expect(lastApi?.activeSessionId).not.toBe(firstId);
    expect(lastApi?.sessions[1]?.name).toMatch(/^zsh\d+/);
  });

  it('adds a session with a custom cwd', () => {
    const rendered = renderHarness({
      projectPath: '/project',
      projectTrusted: true,
      enabled: true,
      defaultCwd: '/home',
    });
    root = rendered.root;
    container = rendered.container;

    act(() => {
      lastApi?.addSession('/custom/path');
    });

    const added = lastApi?.sessions[1];
    expect(added?.cwd).toBe('/custom/path');
  });

  it('closes the active session and falls back to the previous one', () => {
    const rendered = renderHarness({
      projectPath: '/project',
      projectTrusted: true,
      enabled: true,
      defaultCwd: '/home',
    });
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

  it('stays empty after the last session is closed', () => {
    const rendered = renderHarness({
      projectPath: '/project',
      projectTrusted: true,
      enabled: true,
      defaultCwd: '/home',
    });
    root = rendered.root;
    container = rendered.container;

    const onlyId = lastApi?.sessions[0]?.id;
    expect(onlyId).toBeDefined();
    act(() => {
      if (onlyId) lastApi?.closeSession(onlyId);
    });

    expect(lastApi?.sessions).toEqual([]);
    expect(lastApi?.activeSessionId).toBeNull();
  });

  it('updates session status and ptyId', () => {
    const rendered = renderHarness({
      projectPath: '/project',
      projectTrusted: true,
      enabled: true,
      defaultCwd: '/home',
    });
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

  it('adopts a resolved cwd for the session created before one existed', () => {
    const rendered = renderHarness({
      projectPath: null,
      projectTrusted: false,
      enabled: true,
      defaultCwd: '',
    });
    root = rendered.root;
    container = rendered.container;

    expect(lastApi?.sessions.length).toBe(1);
    expect(lastApi?.sessions[0]?.cwd).toBe('');

    act(() => {
      root?.render(
        <TestHarness projectPath={null} projectTrusted={false} enabled defaultCwd="/home" />,
      );
    });

    expect(lastApi?.sessions.length).toBe(1);
    expect(lastApi?.sessions[0]?.cwd).toBe('/home');
    expect(lastApi?.sessions[0]?.status).toBe('idle');
  });

  it('retries a session whose empty cwd already failed to open', () => {
    const rendered = renderHarness({
      projectPath: null,
      projectTrusted: false,
      enabled: true,
      defaultCwd: '',
    });
    root = rendered.root;
    container = rendered.container;

    const id = lastApi?.sessions[0]?.id;
    if (!id) throw new Error('no session');
    act(() => {
      lastApi?.onSessionStatus(id, 'error', null, 'cwd required');
    });
    expect(lastApi?.sessions[0]?.status).toBe('error');

    act(() => {
      root?.render(
        <TestHarness projectPath="/project" projectTrusted enabled defaultCwd="/project" />,
      );
    });

    expect(lastApi?.sessions[0]?.cwd).toBe('/project');
    expect(lastApi?.sessions[0]?.status).toBe('idle');
    expect(lastApi?.sessions[0]?.error).toBeNull();
  });

  it('keeps an opened session cwd when the default changes', () => {
    const rendered = renderHarness({
      projectPath: '/project',
      projectTrusted: true,
      enabled: true,
      defaultCwd: '/project',
    });
    root = rendered.root;
    container = rendered.container;

    const id = lastApi?.sessions[0]?.id;
    if (!id) throw new Error('no session');
    act(() => {
      lastApi?.onSessionStatus(id, 'open', 'pty-1');
    });

    act(() => {
      root?.render(
        <TestHarness
          projectPath="/project"
          projectTrusted
          enabled
          defaultCwd="/elsewhere"
        />,
      );
    });

    expect(lastApi?.sessions[0]?.cwd).toBe('/project');
  });

  it('refuses a fifth session and allows another after one is closed', () => {
    const rendered = renderHarness({
      projectPath: '/project',
      projectTrusted: true,
      enabled: true,
      defaultCwd: '/home',
    });
    root = rendered.root;
    container = rendered.container;

    act(() => {
      for (let added = 1; added < MAX_TERMINAL_SESSIONS; added += 1) {
        expect(lastApi?.addSession()).not.toBeNull();
      }
    });
    expect(lastApi?.sessions.length).toBe(MAX_TERMINAL_SESSIONS);

    let refused: ReturnType<TerminalSessionsApi['addSession']> = null;
    act(() => {
      refused = lastApi?.addSession() ?? null;
    });
    expect(refused).toBeNull();
    expect(lastApi?.sessions.length).toBe(MAX_TERMINAL_SESSIONS);

    const closableId = lastApi?.sessions[MAX_TERMINAL_SESSIONS - 1]?.id;
    act(() => {
      if (closableId) {
        lastApi?.closeSession(closableId);
      }
    });
    expect(lastApi?.sessions.length).toBe(MAX_TERMINAL_SESSIONS - 1);

    let readded: ReturnType<TerminalSessionsApi['addSession']> = null;
    act(() => {
      readded = lastApi?.addSession() ?? null;
    });
    expect(readded).not.toBeNull();
    expect(lastApi?.sessions.length).toBe(MAX_TERMINAL_SESSIONS);
  });
});
