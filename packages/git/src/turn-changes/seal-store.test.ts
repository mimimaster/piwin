import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openTurnChangeStore, type TurnChangeStore } from './store.js';

let dir: string;
let store: TurnChangeStore;

describe('turn-change seal store', () => {
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'piwin-seal-store-'));
    store = openTurnChangeStore({ rootDir: dir });
    store.registerWorkspace({ workspaceId: 'ws', rootPath: '/w', hostInstanceId: 'h' });
    store.createAttempt({ changeSetId: 'cs', attemptId: 'at', sessionId: 's', workspaceId: 'ws' });
  });

  afterEach(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('keeps shell audits per call and replaces a re-reported call', () => {
    store.recordShellAudit({ runId: 'r', toolCallId: 'c1', status: 'clean', paths: [] });
    store.recordShellAudit({ runId: 'r', toolCallId: 'c2', status: 'changed', paths: ['a', 'b'] });
    store.recordShellAudit({ runId: 'r', toolCallId: 'c1', status: 'unknown', paths: [] });
    expect(store.listShellAuditsByRun('r')).toEqual([
      { runId: 'r', toolCallId: 'c1', status: 'unknown', paths: [] },
      { runId: 'r', toolCallId: 'c2', status: 'changed', paths: ['a', 'b'] },
    ]);
  });

  it('publishes line totals, a version note, and activates the version', () => {
    store.publishChangeVersion({
      changeSetId: 'cs',
      revision: 1,
      files: [],
      coverageComplete: true,
      additions: 7,
      deletions: 2,
      binaryFileCount: 1,
    });
    store.recordVersionNote({
      changeSetId: 'cs',
      revision: 1,
      incompleteReason: null,
      excludedPaths: ['gen.txt'],
      overlappingPaths: ['a.txt'],
      sealedAt: '2026-09-29T00:00:00.000Z',
    });
    store.activateVersion('cs', 1, 'ready');
    expect(store.getChangeVersion('cs', 1)).toMatchObject({ additions: 7, deletions: 2, binaryFileCount: 1 });
    expect(store.getVersionNote('cs', 1)?.excludedPaths).toEqual(['gen.txt']);
    expect(store.getVersionNote('cs', 1)?.overlappingPaths).toEqual(['a.txt']);
    expect(store.getAttempt('cs')).toMatchObject({ activeRevision: 1, captureState: 'ready' });
  });

  it('finds unsealed turns only after every segment ended, and closes orphaned ones', () => {
    store.beginRunSegment({ runId: 'r1', attemptId: 'at', source: 'prompt' });
    expect(store.getAttemptIdByRun('r1')).toBe('at');
    expect(store.getChangeSetIdByAttempt('at')).toBe('cs');
    expect(store.listUnsealedEndedChangeSets(10)).toEqual([]);
    expect(store.endOrphanedRunSegments('2026-09-29T00:00:00.000Z')).toEqual(['r1']);
    expect(store.listUnsealedEndedChangeSets(10)).toEqual(['cs']);
    expect(store.endOrphanedRunSegments('2026-09-29T00:00:01.000Z')).toEqual([]);
  });
});
