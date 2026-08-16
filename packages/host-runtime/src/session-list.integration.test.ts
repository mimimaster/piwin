import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostResponse, SessionIndexRecord, SessionListData } from '@piwin/contracts';
import { createSessionRecord, saveSessionIndex } from '@piwin/session';
import { HostRuntime } from './host-runtime.js';
import { getPiwinSessionIndexPath } from './paths.js';

function generalRecord(
  id: string,
  name: string,
  updatedAt: string,
  extras: Partial<SessionIndexRecord> = {},
): SessionIndexRecord {
  const record = createSessionRecord({
    id,
    projectPath: '',
    scope: { kind: 'general' },
    workingDirectory: 'general',
    name,
    nameSource: extras.nameSource ?? 'user',
  });
  record.createdAt = updatedAt;
  record.updatedAt = updatedAt;
  if (extras.isPinned === true) {
    record.isPinned = true;
    record.pinnedAt = extras.pinnedAt ?? updatedAt;
  }
  if (extras.isArchived === true) {
    record.isArchived = true;
    record.archivedAt = extras.archivedAt ?? updatedAt;
  }
  return record;
}

function listData(response: HostResponse): SessionListData {
  if (!response.success) {
    throw new Error(response.error);
  }
  return response.data as SessionListData;
}

async function createSeededRuntime(sessions: SessionIndexRecord[]): Promise<{
  runtime: HostRuntime;
  dispose: () => Promise<void>;
}> {
  const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-session-list-'));
  await saveSessionIndex(getPiwinSessionIndexPath(rootDir), {
    version: 2,
    sessions,
  });
  const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
  return {
    runtime,
    dispose: () => runtime.dispose(),
  };
}

function projectRecord(
  id: string,
  name: string,
  projectPath: string,
  updatedAt: string,
  extras: Partial<SessionIndexRecord> = {},
): SessionIndexRecord {
  const record = createSessionRecord({
    id,
    projectPath,
    scope: { kind: 'project', projectPath },
    workingDirectory: projectPath,
    name,
    nameSource: extras.nameSource ?? 'user',
  });
  record.createdAt = updatedAt;
  record.updatedAt = updatedAt;
  if (extras.isPinned === true) {
    record.isPinned = true;
    record.pinnedAt = extras.pinnedAt ?? updatedAt;
  }
  if (extras.isArchived === true) {
    record.isArchived = true;
    record.archivedAt = extras.archivedAt ?? updatedAt;
  }
  return record;
}

const ORDER_FIXTURE: SessionIndexRecord[] = [
  generalRecord('id-alpha', 'Alpha', '2026-08-01T00:00:00.000Z'),
  generalRecord('id-bravo', 'Bravo', '2026-08-05T00:00:00.000Z'),
  generalRecord('id-zulu', 'Zulu', '2026-08-10T00:00:00.000Z', {
    isPinned: true,
    pinnedAt: '2026-08-11T00:00:00.000Z',
  }),
  generalRecord('id-archived', 'Archived', '2026-08-12T00:00:00.000Z', {
    isArchived: true,
    archivedAt: '2026-08-12T00:00:00.000Z',
  }),
  projectRecord('id-project-1', 'Project Alpha', '/tmp/proj-1', '2026-08-13T00:00:00.000Z', {
    isArchived: true,
    archivedAt: '2026-08-13T00:00:00.000Z',
  }),
  generalRecord('id-placeholder', 'session-placeholder', '2026-08-09T00:00:00.000Z', {
    nameSource: 'default',
  }),
];

describe('HostRuntime session/list', () => {
  it('applies global order before truncation and reports totalCount', async () => {
    const { runtime, dispose } = await createSeededRuntime(ORDER_FIXTURE);
    try {
      const alphabetical = listData(
        await runtime.handleCommand({
          type: 'session/list',
          scope: { kind: 'general' },
          order: 'alphabetical',
          maxItems: 2,
        }),
      );
      expect(alphabetical.sessions.map((session) => session.name)).toEqual(['Alpha', 'Bravo']);
      expect(alphabetical.totalCount).toBe(3);
      expect(alphabetical.truncated).toBe(true);

      const updated = listData(
        await runtime.handleCommand({
          type: 'session/list',
          scope: { kind: 'general' },
          order: 'updated',
          maxItems: 2,
        }),
      );
      expect(updated.sessions.map((session) => session.name)).toEqual(['Zulu', 'Bravo']);
      expect(updated.totalCount).toBe(3);
      expect(updated.truncated).toBe(true);
    } finally {
      await dispose();
    }
  });

  it('returns every matching session when order and maxItems are omitted', async () => {
    const { runtime, dispose } = await createSeededRuntime(ORDER_FIXTURE);
    try {
      const listed = listData(
        await runtime.handleCommand({
          type: 'session/list',
          scope: { kind: 'general' },
        }),
      );
      expect(listed.sessions.map((session) => session.name)).toEqual(['Zulu', 'Bravo', 'Alpha']);
      expect(listed.totalCount).toBe(3);
      expect(listed.truncated).toBe(false);
    } finally {
      await dispose();
    }
  });

  it('preserves includeArchived and still reports projection metadata', async () => {
    const { runtime, dispose } = await createSeededRuntime(ORDER_FIXTURE);
    try {
      const withArchived = listData(
        await runtime.handleCommand({
          type: 'session/list',
          scope: { kind: 'general' },
          includeArchived: true,
          order: 'alphabetical',
        }),
      );
      expect(withArchived.sessions.map((session) => session.name)).toEqual([
        'Alpha',
        'Archived',
        'Bravo',
        'Zulu',
      ]);
      expect(withArchived.totalCount).toBe(4);
      expect(withArchived.truncated).toBe(false);
    } finally {
      await dispose();
    }
  });

  it('lists sessions across all scopes when allScopes is true', async () => {
    const { runtime, dispose } = await createSeededRuntime(ORDER_FIXTURE);
    try {
      const all = listData(
        await runtime.handleCommand({
          type: 'session/list',
          allScopes: true,
          includeArchived: true,
          order: 'alphabetical',
        }),
      );
      expect(all.sessions.map((session) => session.name)).toEqual([
        'Alpha',
        'Archived',
        'Bravo',
        'Project Alpha',
        'Zulu',
      ]);
      expect(all.totalCount).toBe(5);
      expect(all.truncated).toBe(false);
    } finally {
      await dispose();
    }
  });

  it('rejects maxItems that are not a positive safe integer', async () => {
    const { runtime, dispose } = await createSeededRuntime(ORDER_FIXTURE);
    try {
      const response = await runtime.handleCommand({
        type: 'session/list',
        scope: { kind: 'general' },
        maxItems: 0,
      });
      expect(response.success).toBe(false);
      if (response.success) {
        throw new Error('expected session/list to reject invalid maxItems');
      }
      expect(response.error).toMatch(/maxItems must be a positive safe integer/i);
    } finally {
      await dispose();
    }
  });
});
