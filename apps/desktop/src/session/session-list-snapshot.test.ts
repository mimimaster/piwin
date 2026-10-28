import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectRecord } from '@piwin/contracts';
import type { SessionListItemUi } from '../conversation/chat-ui-types';
import {
  buildSessionListSnapshot,
  formatSnapshotSyncTime,
  MAX_SNAPSHOT_PREVIEW_CHARS,
  MAX_SNAPSHOT_SESSIONS_PER_SCOPE,
  parseSessionListSnapshot,
  readSessionListSnapshot,
  sessionListSnapshotKey,
  writeSessionListSnapshot,
} from './session-list-snapshot';
import {
  blockedByOfflineSessionSnapshot,
  getOfflineSessionSnapshot,
  offlineSnapshotNotice,
  setOfflineSessionSnapshot,
} from './offline-session-snapshot';
import { sessionSnapshotHostKey, snapshotRestoreActions } from '../hooks/use-session-list-snapshot';

vi.mock('@piwin/ui-kit', () => ({ showInfoNotification: vi.fn() }));

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

const project: ProjectRecord = {
  path: 'prj_1',
  trust: 'trusted',
  displayName: 'piwin',
  lastOpenedAt: '2026-10-27T08:00:00.000Z',
  createdAt: '2026-10-01T08:00:00.000Z',
  gitRootPath: '/Users/someone/piwin',
  bashAllowlist: ['pnpm test'],
  fileWriteAllowlist: ['src/'],
  networkPolicy: { allowedFetchHosts: ['example.com'], allowWebSearch: true },
  currentBranch: 'main',
};

function session(id: string, extra: Partial<SessionListItemUi> = {}): SessionListItemUi {
  return { id, name: `Session ${id}`, updatedAt: '2026-10-27T08:00:00.000Z', ...extra };
}

describe('session list snapshot', () => {
  it('keeps what the sidebar shows and drops Host paths and transient state', () => {
    const snapshot = buildSessionListSnapshot({
      general: [
        session('g1', {
          lastPreview: 'x'.repeat(500),
          isPinned: true,
          nativeCli: { kind: 'native', sessionId: 'g1', ptyId: 'pty_1' },
          model: { providerId: 'p', modelId: 'm' },
        }),
      ],
      projectSessionsByPath: { prj_1: [session('p1')], prj_gone: [session('p2')] },
      recentProjects: [project],
      now: new Date('2026-10-28T06:00:00.000Z'),
    });
    expect(snapshot.savedAt).toBe('2026-10-28T06:00:00.000Z');
    const [row] = snapshot.general;
    expect(row?.lastPreview).toHaveLength(MAX_SNAPSHOT_PREVIEW_CHARS);
    expect(row?.isPinned).toBe(true);
    expect(row).not.toHaveProperty('nativeCli');
    expect(row).not.toHaveProperty('model');
    // Only folders the sidebar lists are kept.
    expect(Object.keys(snapshot.projects)).toEqual(['prj_1']);
    expect(snapshot.recentProjects).toEqual([
      {
        path: 'prj_1',
        trust: 'trusted',
        displayName: 'piwin',
        lastOpenedAt: project.lastOpenedAt,
        createdAt: project.createdAt,
        currentBranch: 'main',
      },
    ]);
  });

  it('caps each scope', () => {
    const many = Array.from({ length: MAX_SNAPSHOT_SESSIONS_PER_SCOPE + 20 }, (_, index) =>
      session(`s${index}`),
    );
    const snapshot = buildSessionListSnapshot({
      general: many,
      projectSessionsByPath: {},
      recentProjects: [],
    });
    expect(snapshot.general).toHaveLength(MAX_SNAPSHOT_SESSIONS_PER_SCOPE);
  });

  it('round-trips per Host and never overwrites with an empty list', () => {
    const storage = memoryStorage();
    const full = buildSessionListSnapshot({
      general: [session('g1')],
      projectSessionsByPath: {},
      recentProjects: [],
    });
    writeSessionListSnapshot(storage, 'host-a', full);
    writeSessionListSnapshot(
      storage,
      'host-a',
      buildSessionListSnapshot({ general: [], projectSessionsByPath: {}, recentProjects: [] }),
    );
    expect(readSessionListSnapshot(storage, 'host-a')?.general.map((row) => row.id)).toEqual([
      'g1',
    ]);
    expect(readSessionListSnapshot(storage, 'host-b')).toBeUndefined();
    expect([...storage.data.keys()]).toEqual([sessionListSnapshotKey('host-a')]);
  });

  it('rejects unreadable or foreign data', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(parseSessionListSnapshot('{not json')).toBeUndefined();
    expect(parseSessionListSnapshot(JSON.stringify({ version: 2, savedAt: 'x' }))).toBeUndefined();
    const parsed = parseSessionListSnapshot(
      JSON.stringify({
        version: 1,
        savedAt: '2026-10-28T06:00:00.000Z',
        general: [{ id: 'ok', name: 'Ok' }, { id: 3 }, null],
        projects: { prj_1: [{ name: 'no id' }] },
        recentProjects: [{ path: 'prj_1', trust: 'maybe' }],
      }),
    );
    expect(parsed?.general.map((row) => row.id)).toEqual(['ok']);
    expect(parsed?.projects).toEqual({});
    expect(parsed?.recentProjects).toEqual([]);
    warn.mockRestore();
  });

  it('survives storage that throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(readSessionListSnapshot(broken, 'host-a')).toBeUndefined();
    expect(() =>
      writeSessionListSnapshot(
        broken,
        'host-a',
        buildSessionListSnapshot({
          general: [session('g1')],
          projectSessionsByPath: {},
          recentProjects: [],
        }),
      ),
    ).not.toThrow();
    warn.mockRestore();
  });

  it('formats the sync time like the classic interface', () => {
    const now = new Date(2026, 9, 28, 15, 0);
    expect(formatSnapshotSyncTime(new Date(2026, 9, 28, 9, 5).toISOString(), 'zh-CN', now)).toBe(
      '09:05',
    );
    expect(formatSnapshotSyncTime(new Date(2026, 9, 27, 21, 30).toISOString(), 'zh-CN', now)).toBe(
      '10月27日 21:30',
    );
    expect(formatSnapshotSyncTime(new Date(2026, 9, 27, 21, 30).toISOString(), 'en', now)).toBe(
      'Oct 27 21:30',
    );
    expect(formatSnapshotSyncTime('garbage', 'zh-CN', now)).toBe('未知');
  });
});

describe('snapshot restore', () => {
  it('fills the general scope and every stored project scope', () => {
    const snapshot = buildSessionListSnapshot({
      general: [session('g1')],
      projectSessionsByPath: { prj_1: [session('p1')] },
      recentProjects: [project],
    });
    expect(
      snapshotRestoreActions(snapshot).map((action) => [
        action.scope,
        action.sessions.map((row) => row.id),
      ]),
    ).toEqual([
      [{ kind: 'general' }, ['g1']],
      [{ kind: 'project', projectPath: 'prj_1' }, ['p1']],
    ]);
  });

  it('keys by Host book id first, then endpoint', () => {
    expect(sessionSnapshotHostKey({ endpoint: 'ws://10.0.0.2:8787', hostId: 'host_1' })).toBe(
      'host_1',
    );
    expect(sessionSnapshotHostKey({ endpoint: ' ws://10.0.0.2:8787 ' })).toBe('ws://10.0.0.2:8787');
    expect(sessionSnapshotHostKey({ endpoint: '' })).toBeNull();
    expect(sessionSnapshotHostKey(undefined)).toBeNull();
  });
});

describe('offline session snapshot state', () => {
  afterEach(() => setOfflineSessionSnapshot(null));

  it('blocks session actions only while the snapshot stands in', () => {
    expect(blockedByOfflineSessionSnapshot('zh-CN')).toBe(false);
    setOfflineSessionSnapshot({ savedAt: '2026-10-28T06:00:00.000Z' });
    expect(getOfflineSessionSnapshot()).not.toBeNull();
    expect(blockedByOfflineSessionSnapshot('zh-CN')).toBe(true);
    setOfflineSessionSnapshot(null);
    expect(blockedByOfflineSessionSnapshot('zh-CN')).toBe(false);
  });

  it('describes the snapshot in the sidebar notice', () => {
    const now = new Date(2026, 9, 28, 15, 0);
    const notice = offlineSnapshotNotice(
      { savedAt: new Date(2026, 9, 28, 14, 5).toISOString() },
      'zh-CN',
      now,
    );
    expect(notice.title).toBe('离线快照');
    expect(notice.message).toContain('14:05');
  });
});
