import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getSessionLineage, countDirectForks, getDirectForkNames } from './session-lineage.js';
import { createSessionRecord, upsertSessionRecord } from './session-index-store.js';
import type { ProductSessionOrigin, SessionIndexRecord } from '@piwin/contracts';

describe('getSessionLineage', () => {
  let tempDir: string;
  let indexPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'piwin-lineage-test-'));
    indexPath = join(tempDir, 'index.json');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns single-node lineage for a root session', async () => {
    await upsertSessionRecord(indexPath, createSessionRecord({
      id: 'root-1', projectPath: '/test', name: 'Root', kind: 'main', depth: 0,
    }));
    const lineage = await getSessionLineage({ indexPath }, 'root-1');
    expect(lineage.rootSessionId).toBe('root-1');
    expect(lineage.activeSessionId).toBe('root-1');
    expect(lineage.rootMissing).toBe(false);
    expect(lineage.nodes).toHaveLength(1);
    expect(lineage.nodes[0]!.sessionId).toBe('root-1');
  });

  it('includes forks in lineage', async () => {
    await upsertSessionRecord(indexPath, createSessionRecord({
      id: 'root-1', projectPath: '/test', name: 'Root', kind: 'main', depth: 0,
    }));
    const forkRecord = createSessionRecord({
      id: 'fork-1', projectPath: '/test', name: 'Root · Branch', kind: 'main', depth: 0,
    });
    const origin: ProductSessionOrigin = {
      kind: 'fork', rootSessionId: 'root-1', sourceSessionId: 'root-1',
      sourceMessageId: 'msg-1', sourceMessageRole: 'assistant',
      sourceMessagePreview: 'test', sourceMessageCreatedAt: '2026-01-01T00:00:00Z',
      workspaceStrategy: 'shared', createdAt: '2026-01-01T00:00:01Z',
    };
    forkRecord.origin = origin;
    await upsertSessionRecord(indexPath, forkRecord);

    const lineage = await getSessionLineage({ indexPath }, 'fork-1');
    expect(lineage.rootSessionId).toBe('root-1');
    expect(lineage.nodes).toHaveLength(2);
    // Root should be first
    expect(lineage.nodes[0]!.sessionId).toBe('root-1');
    expect(lineage.nodes[1]!.sessionId).toBe('fork-1');
  });

  it('returns rootMissing when root is deleted', async () => {
    // Only the fork exists, root was deleted
    const forkRecord = createSessionRecord({
      id: 'fork-1', projectPath: '/test', name: 'Root · Branch', kind: 'main', depth: 0,
    });
    const origin: ProductSessionOrigin = {
      kind: 'fork', rootSessionId: 'root-1', sourceSessionId: 'root-1',
      sourceMessageId: 'msg-1', sourceMessageRole: 'assistant',
      sourceMessagePreview: 'test', sourceMessageCreatedAt: '2026-01-01T00:00:00Z',
      workspaceStrategy: 'shared', createdAt: '2026-01-01T00:00:01Z',
    };
    forkRecord.origin = origin;
    await upsertSessionRecord(indexPath, forkRecord);

    const lineage = await getSessionLineage({ indexPath }, 'fork-1');
    expect(lineage.rootSessionId).toBe('root-1');
    expect(lineage.rootMissing).toBe(true);
    expect(lineage.nodes).toHaveLength(1);
  });
});

describe('countDirectForks', () => {
  it('counts forks with matching sourceSessionId', () => {
    const records: SessionIndexRecord[] = [
      { id: 'root', projectPath: '/test', createdAt: '', updatedAt: '', messageCount: 0 },
      {
        id: 'fork-1', projectPath: '/test', createdAt: '', updatedAt: '', messageCount: 0,
        origin: { kind: 'fork', rootSessionId: 'root', sourceSessionId: 'root',
          sourceMessageId: 'm1', sourceMessageRole: 'assistant', sourceMessagePreview: '',
          sourceMessageCreatedAt: '', workspaceStrategy: 'shared', createdAt: '' },
      },
      {
        id: 'fork-2', projectPath: '/test', createdAt: '', updatedAt: '', messageCount: 0,
        origin: { kind: 'fork', rootSessionId: 'root', sourceSessionId: 'root',
          sourceMessageId: 'm2', sourceMessageRole: 'assistant', sourceMessagePreview: '',
          sourceMessageCreatedAt: '', workspaceStrategy: 'shared', createdAt: '' },
      },
      {
        id: 'fork-3', projectPath: '/test', createdAt: '', updatedAt: '', messageCount: 0,
        origin: { kind: 'fork', rootSessionId: 'root', sourceSessionId: 'fork-1',
          sourceMessageId: 'm1', sourceMessageRole: 'assistant', sourceMessagePreview: '',
          sourceMessageCreatedAt: '', workspaceStrategy: 'shared', createdAt: '' },
      },
    ];
    expect(countDirectForks(records, 'root')).toBe(2);
    expect(countDirectForks(records, 'fork-1')).toBe(1);
    expect(countDirectForks(records, 'fork-2')).toBe(0);
  });
});

describe('getDirectForkNames', () => {
  it('returns names of direct forks', () => {
    const records: SessionIndexRecord[] = [
      {
        id: 'fork-1', projectPath: '/test', createdAt: '', updatedAt: '', messageCount: 0,
        name: 'Root · Branch',
        origin: { kind: 'fork', rootSessionId: 'root', sourceSessionId: 'root',
          sourceMessageId: 'm1', sourceMessageRole: 'assistant', sourceMessagePreview: '',
          sourceMessageCreatedAt: '', workspaceStrategy: 'shared', createdAt: '' },
      },
      {
        id: 'fork-2', projectPath: '/test', createdAt: '', updatedAt: '', messageCount: 0,
        name: 'Root · Branch 2',
        origin: { kind: 'fork', rootSessionId: 'root', sourceSessionId: 'root',
          sourceMessageId: 'm2', sourceMessageRole: 'assistant', sourceMessagePreview: '',
          sourceMessageCreatedAt: '', workspaceStrategy: 'shared', createdAt: '' },
      },
    ];
    const names = getDirectForkNames(records, 'root');
    expect(names).toEqual(['Root · Branch', 'Root · Branch 2']);
  });
});
