// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { HostClient } from '../host/host-client.js';
import {
  buildSessionListSnapshot,
  readSessionListSnapshot,
  writeSessionListSnapshot,
} from '../session/session-list-snapshot.js';
import { useSessionListSnapshot } from './use-session-list-snapshot.js';
import { prepareRendererRelaunch } from '../platform/renderer-relaunch-preparation.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

it('restores a local Host sidebar without waiting for its startup', () => {
  vi.useFakeTimers();
  writeSessionListSnapshot(
    localStorage,
    'local',
    buildSessionListSnapshot({
      general: [{ id: 'saved', name: 'Saved conversation' }],
      projectSessionsByPath: {},
      recentProjects: [],
    }),
  );
  const hostClient = { getTransport: () => 'live' } as unknown as HostClient;
  const dispatch = vi.fn();
  function Harness() {
    useSessionListSnapshot({
      hostClient,
      hostReady: false,
      generalSessions: [],
      projectSessionsByPath: {},
      recentProjects: [],
      setRecentProjects: vi.fn(),
      dispatch,
    });
    return null;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    act(() => root.render(<Harness />));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session/hydrate-scope',
        sessions: [{ id: 'saved', name: 'Saved conversation' }],
      }),
    );
  } finally {
    act(() => root.unmount());
  }
});

it('flushes the local sidebar before native renderer reclamation skips pagehide', () => {
  vi.useFakeTimers();
  const hostClient = { getTransport: () => 'live' } as unknown as HostClient;
  function Harness() {
    useSessionListSnapshot({
      hostClient,
      hostReady: true,
      generalSessions: [{ id: 'latest', name: 'Latest local session' }],
      projectSessionsByPath: {},
      recentProjects: [],
      setRecentProjects: vi.fn(),
      dispatch: vi.fn(),
    });
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    act(() => root.render(<Harness />));
    expect(readSessionListSnapshot(localStorage, 'local')).toBeUndefined();
    act(() => prepareRendererRelaunch());
    expect(readSessionListSnapshot(localStorage, 'local')?.general.map((row) => row.id)).toEqual([
      'latest',
    ]);
  } finally {
    act(() => root.unmount());
  }
});
