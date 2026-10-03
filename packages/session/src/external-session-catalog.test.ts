import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSessionRecord, getSessionRecord, loadSessionIndex, upsertSessionRecord } from './session-index-store.js';
import { syncExternalSessionCatalog } from './external-session-catalog.js';
import { evaluateColdStorageEligibility } from './session-cold-storage-eligibility.js';

let directory: string;
let indexPath: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'piwin-catalog-'));
  indexPath = join(directory, 'sessions.json');
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('syncExternalSessionCatalog', () => {
  it('creates, updates and removes external sessions without touching Pi records', async () => {
    const pi = createSessionRecord({ id: 'pi-1', projectPath: '/proj' });
    await upsertSessionRecord(indexPath, pi);
    let counter = 0;
    const first = await syncExternalSessionCatalog({
      indexPath,
      agentId: 'grok',
      entries: [
        { backendSessionId: 'g-1', title: 'From TUI', cwd: '/proj', lastChangeUnixMs: Date.parse('2026-09-29T00:00:00Z') },
        { backendSessionId: 'g-2', cwd: '/elsewhere' },
      ],
      createProductSessionId: () => `p-${++counter}`,
      resolveProjectPath: (cwd) => (cwd === '/proj' ? '/proj' : ''),
    });
    expect(first.created.map((record) => record.backend?.backendSessionId)).toEqual(['g-1', 'g-2']);
    const created = await getSessionRecord(indexPath, 'p-1');
    expect(created).toMatchObject({
      name: 'From TUI',
      nameSource: 'llm',
      scope: { kind: 'project', projectPath: '/proj' },
      backend: { agentId: 'grok', backendSessionId: 'g-1' },
    });
    expect((await getSessionRecord(indexPath, 'p-2'))?.scope).toEqual({ kind: 'general' });

    // User renames locally, then the catalog drops g-2 and retitles g-1.
    const record = await getSessionRecord(indexPath, 'p-1');
    if (record === undefined) throw new Error('missing');
    record.nameSource = 'user';
    record.name = 'Mine';
    await upsertSessionRecord(indexPath, record);
    const second = await syncExternalSessionCatalog({
      indexPath,
      agentId: 'grok',
      entries: [{ backendSessionId: 'g-1', title: 'Grok title' }],
      createProductSessionId: () => 'unused',
      resolveProjectPath: () => '',
    });
    expect(second.removed.map((item) => item.id)).toEqual(['p-2']);
    expect((await getSessionRecord(indexPath, 'p-1'))?.name).toBe('Mine');
    const ids = (await loadSessionIndex(indexPath)).sessions.map((item) => item.id).sort();
    expect(ids).toEqual(['p-1', 'pi-1']);
  });

  it('rehomes a general external session when resolve returns a project path', async () => {
    const existing = createSessionRecord({
      id: 'p-1',
      projectPath: '',
      scope: { kind: 'general' },
      workingDirectory: '/proj/sub',
    });
    existing.backend = { agentId: 'grok', backendSessionId: 'g-1' };
    await upsertSessionRecord(indexPath, existing);

    const result = await syncExternalSessionCatalog({
      indexPath,
      agentId: 'grok',
      entries: [{ backendSessionId: 'g-1', cwd: '/proj/sub' }],
      createProductSessionId: () => 'unused',
      resolveProjectPath: (cwd) => (cwd === '/proj/sub' ? '/proj' : ''),
    });

    expect(result.updated.map((record) => record.id)).toEqual(['p-1']);
    expect(await getSessionRecord(indexPath, 'p-1')).toMatchObject({
      projectPath: '/proj',
      scope: { kind: 'project', projectPath: '/proj' },
    });
  });

  it('keeps external sessions out of cold storage', () => {
    const record = { ...createSessionRecord({ id: 'g', projectPath: '/p' }), isArchived: true, backend: { agentId: 'grok' } };
    expect(
      evaluateColdStorageEligibility({
        record,
        config: { enabled: true, packOutputDir: '/out', minArchivedAgeDays: 0 },
        live: false,
        transcriptExists: true,
        ignoreAge: true,
      }),
    ).toEqual({ eligible: false, reason: 'not-main' });
  });
});
