import { describe, expect, it } from 'vitest';
import type { PiwinConfig, SessionScope } from '@piwin/contracts';
import {
  lastSessionPersistUnchanged,
  planLastSessionRestore,
  resolveSessionScopeHintFromSearchHits,
  planRecentProjectSessionHydration,
  planRemoteSessionCatchUp,
  shouldHydrateInitialGeneralSessions,
} from './workbench-session-lifecycle.js';

const emptyConfig = { providers: [] } as unknown as PiwinConfig;
const configWithLastGeneral = {
  providers: [],
  desktop: {
    lastSession: { sessionId: 'sess-1', scope: { kind: 'general' } },
  },
} as unknown as PiwinConfig;
const configWithLastProject = {
  providers: [],
  desktop: {
    lastSession: {
      sessionId: 'sess-2',
      scope: { kind: 'project', projectPath: '/repo' },
    },
  },
} as unknown as PiwinConfig;

describe('shouldHydrateInitialGeneralSessions', () => {
  it('skips when the host is not ready, a project is open, or it already ran', () => {
    expect(
      shouldHydrateInitialGeneralSessions({
        hostReady: false,
        projectPath: null,
        alreadyHydrated: false,
        isRemote: false,
        config: emptyConfig,
      }),
    ).toBe(false);
    expect(
      shouldHydrateInitialGeneralSessions({
        hostReady: true,
        projectPath: '/repo',
        alreadyHydrated: false,
        isRemote: false,
        config: emptyConfig,
      }),
    ).toBe(false);
    expect(
      shouldHydrateInitialGeneralSessions({
        hostReady: true,
        projectPath: null,
        alreadyHydrated: true,
        isRemote: false,
        config: emptyConfig,
      }),
    ).toBe(false);
  });

  it('skips local until the first config arrives, and when lastSession owns restore', () => {
    expect(
      shouldHydrateInitialGeneralSessions({
        hostReady: true,
        projectPath: null,
        alreadyHydrated: false,
        isRemote: false,
        config: null,
      }),
    ).toBe(false);
    expect(
      shouldHydrateInitialGeneralSessions({
        hostReady: true,
        projectPath: null,
        alreadyHydrated: false,
        isRemote: false,
        config: configWithLastGeneral,
      }),
    ).toBe(false);
  });

  it('runs for remote with a null config, and for local config without lastSession', () => {
    expect(
      shouldHydrateInitialGeneralSessions({
        hostReady: true,
        projectPath: null,
        alreadyHydrated: false,
        isRemote: true,
        config: null,
      }),
    ).toBe(true);
    expect(
      shouldHydrateInitialGeneralSessions({
        hostReady: true,
        projectPath: null,
        alreadyHydrated: false,
        isRemote: false,
        config: emptyConfig,
      }),
    ).toBe(true);
  });
});

describe('planRemoteSessionCatchUp', () => {
  it('skips until a catch-up epoch arrives on a ready host', () => {
    expect(
      planRemoteSessionCatchUp({
        catchUpEpoch: 0,
        hostReady: true,
        isRemote: true,
        projectPath: null,
      }),
    ).toEqual({ kind: 'skip' });
    expect(
      planRemoteSessionCatchUp({
        catchUpEpoch: 1,
        hostReady: false,
        isRemote: true,
        projectPath: null,
      }),
    ).toEqual({ kind: 'skip' });
  });

  it('resets flags on a local host and hydrates the open scope on remote', () => {
    expect(
      planRemoteSessionCatchUp({
        catchUpEpoch: 2,
        hostReady: true,
        isRemote: false,
        projectPath: '/repo',
      }),
    ).toEqual({ kind: 'reset-flags' });
    expect(
      planRemoteSessionCatchUp({
        catchUpEpoch: 2,
        hostReady: true,
        isRemote: true,
        projectPath: '/repo',
      }),
    ).toEqual({
      kind: 'hydrate',
      scope: { kind: 'project', projectPath: '/repo' },
    });
    expect(
      planRemoteSessionCatchUp({
        catchUpEpoch: 2,
        hostReady: true,
        isRemote: true,
        projectPath: null,
      }),
    ).toEqual({ kind: 'hydrate', scope: { kind: 'general' } });
  });
});

describe('planRecentProjectSessionHydration', () => {
  it('skips when the host is not ready and retains when the key is unchanged', () => {
    expect(
      planRecentProjectSessionHydration({
        hostReady: false,
        recentProjectPaths: ['/a'],
        lastHydratedKey: '',
      }),
    ).toEqual({ kind: 'skip' });
    expect(
      planRecentProjectSessionHydration({
        hostReady: true,
        recentProjectPaths: [],
        lastHydratedKey: '',
      }),
    ).toEqual({ kind: 'retain-only', projectPaths: [] });
    expect(
      planRecentProjectSessionHydration({
        hostReady: true,
        recentProjectPaths: ['/a', '/b'],
        lastHydratedKey: '/a\0/b',
      }),
    ).toEqual({ kind: 'retain-only', projectPaths: ['/a', '/b'] });
  });

  it('hydrates when the recent-project set changes', () => {
    expect(
      planRecentProjectSessionHydration({
        hostReady: true,
        recentProjectPaths: ['/a', '/b'],
        lastHydratedKey: '/a',
      }),
    ).toEqual({
      kind: 'hydrate',
      projectPaths: ['/a', '/b'],
      nextKey: '/a\0/b',
    });
  });
});

describe('planLastSessionRestore', () => {
  it('skips until a ready host has loaded config, and only once', () => {
    expect(
      planLastSessionRestore({
        hostReady: false,
        config: configWithLastGeneral,
        alreadyRestored: false,
      }),
    ).toEqual({ kind: 'skip' });
    expect(
      planLastSessionRestore({
        hostReady: true,
        config: null,
        alreadyRestored: false,
      }),
    ).toEqual({ kind: 'skip' });
    expect(
      planLastSessionRestore({
        hostReady: true,
        config: configWithLastGeneral,
        alreadyRestored: true,
      }),
    ).toEqual({ kind: 'skip' });
  });

  it('consumes the first config even without lastSession, then restores project vs general', () => {
    expect(
      planLastSessionRestore({
        hostReady: true,
        config: emptyConfig,
        alreadyRestored: false,
      }),
    ).toEqual({ kind: 'consume-without-restore' });
    expect(
      planLastSessionRestore({
        hostReady: true,
        config: configWithLastProject,
        alreadyRestored: false,
      }),
    ).toEqual({
      kind: 'restore-project',
      projectPath: '/repo',
      sessionId: 'sess-2',
    });
    expect(
      planLastSessionRestore({
        hostReady: true,
        config: configWithLastGeneral,
        alreadyRestored: false,
      }),
    ).toEqual({ kind: 'restore-general', sessionId: 'sess-1' });
  });
});

describe('resolveSessionScopeHintFromSearchHits', () => {
  it('prefers an explicit hit scope, else infers from projectPath', () => {
    expect(resolveSessionScopeHintFromSearchHits(null, 's1')).toBeUndefined();
    expect(
      resolveSessionScopeHintFromSearchHits(
        {
          general: [
            {
              sessionId: 's1',
              name: 'A',
              projectPath: '',
              scope: { kind: 'general' },
            },
          ],
        },
        's1',
      ),
    ).toEqual({ kind: 'general' });
    expect(
      resolveSessionScopeHintFromSearchHits(
        { p: [{ sessionId: 's2', name: 'B', projectPath: '/repo' }] },
        's2',
      ),
    ).toEqual({ kind: 'project', projectPath: '/repo' });
  });
});

describe('lastSessionPersistUnchanged', () => {
  const general: SessionScope = { kind: 'general' };
  it('detects an already-persisted restore pointer', () => {
    expect(
      lastSessionPersistUnchanged(
        { lastSession: { sessionId: 'sess-1', scope: general } },
        { sessionId: 'sess-1', scope: general },
      ),
    ).toBe(true);
    expect(
      lastSessionPersistUnchanged(
        { lastSession: { sessionId: 'sess-1', scope: general } },
        { sessionId: 'sess-2', scope: general },
      ),
    ).toBe(false);
  });
});
