import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SessionPackStaleError,
  SessionStorageConflictError,
  createDefaultSessionColdStorageConfig,
} from '@piwin/contracts';
import { createSessionRecord, upsertSessionRecord } from './session-index-store.js';
import { evaluateColdStorageEligibility } from './session-cold-storage-eligibility.js';
import {
  createColdStorageJournal,
  getColdStorageQuarantineDir,
  listColdStorageJournals,
  pathExists,
  updateColdStorageJournalPhase,
} from './session-cold-storage-journal.js';

import { offloadSessionPayload } from './session-cold-storage-offload.js';
import { restoreSessionPayload } from './session-cold-storage-restore.js';
import {
  reconcileSessionColdStorage,
  recoverJournaledColdStorageTransactions,
} from './session-cold-storage-reconcile.js';
import {
  buildSessionColdStoragePlan,
  checkpointTranscriptWal,
  createColdStorageConfirmationDigest,
  hashSessionPayload,
  openSessionTranscriptStore,
  USER_AUTHORED_GENERATION,
} from './index.js';
import { getSessionRecord } from './session-index-store.js';

async function seedLocalSession(rootDir: string, sessionId: string): Promise<{
  record: ReturnType<typeof createSessionRecord>;
  indexPath: string;
  transcriptPath: string;
  mediaDir: string;
  stagingDir: string;
  outputDir: string;
}> {
  const indexPath = join(rootDir, 'sessions-index', 'index.json');
  const sessionDir = join(rootDir, 'sessions', sessionId);
  const transcriptPath = join(sessionDir, 'transcript.sqlite3');
  const mediaDir = join(rootDir, 'media', sessionId);
  const stagingDir = join(rootDir, 'pack-staging');
  const outputDir = await mkdtemp(join(tmpdir(), 'piwin-cold-out-'));
  await mkdir(sessionDir, { recursive: true });
  await mkdir(mediaDir, { recursive: true });
  const store = await openSessionTranscriptStore({
    dbPath: transcriptPath,
    sessionId,
    projectPath: '/tmp/project',
  });
  await store.appendMessage({
    id: 'msg_1',
    runtimeGenerationId: USER_AUTHORED_GENERATION,
    backendMessageId: 'b1',
    role: 'user',
    text: 'cold payload',
    status: 'done',
    createdAt: new Date().toISOString(),
  });
  store.close();
  await checkpointTranscriptWal(transcriptPath);
  await writeFile(join(mediaDir, 'note.txt'), 'media\n', 'utf8');
  await writeFile(join(sessionDir, 'plan.json'), '{"title":"keep me"}\n', 'utf8');
  const record = createSessionRecord({
    id: sessionId,
    projectPath: '/tmp/project',
    name: 'Cold session',
    kind: 'main',
  });
  record.isArchived = true;
  record.archivedAt = '2026-06-01T00:00:00.000Z';
  record.messageCount = 1;
  record.lastPreview = 'cold payload';
  await upsertSessionRecord(indexPath, record);
  return { record, indexPath, transcriptPath, mediaDir, stagingDir, outputDir };
}

async function planHashes(fixture: Awaited<ReturnType<typeof seedLocalSession>>) {
  const plan = await buildSessionColdStoragePlan({
    records: [fixture.record],
    config: {
      enabled: true,
      packOutputDir: fixture.outputDir,
      minArchivedAgeDays: 1,
    },
    resolvePaths: () => ({
      transcriptPath: fixture.transcriptPath,
      mediaDir: fixture.mediaDir,
    }),
    isLive: () => false,
    transcriptExists: async () => true,
    explicitSessionIds: [fixture.record.id],
  });
  const target = plan.targets[0];
  if (!target) {
    throw new Error('expected a cold-storage plan target');
  }
  return target;
}

describe('cold storage eligibility', () => {
  const base = createSessionRecord({
    id: 'ses_1',
    projectPath: '/tmp/p',
    name: 'Archived',
    kind: 'main',
  });
  base.isArchived = true;
  base.archivedAt = '2026-06-01T00:00:00.000Z';

  it('accepts an old archived local main session when enabled', () => {
    const result = evaluateColdStorageEligibility({
      record: base,
      config: {
        enabled: true,
        packOutputDir: '/tmp/packs',
        minArchivedAgeDays: 30,
      },
      live: false,
      transcriptExists: true,
      now: new Date('2026-08-12T00:00:00.000Z'),
    });
    expect(result).toEqual({ eligible: true });
  });

  it('rejects disabled, live, pinned, young, and offloaded sessions', () => {
    const config = {
      enabled: true,
      packOutputDir: '/tmp/packs',
      minArchivedAgeDays: 30,
    };
    expect(
      evaluateColdStorageEligibility({
        record: base,
        config: createDefaultSessionColdStorageConfig(),
        live: false,
        transcriptExists: true,
      }).eligible,
    ).toBe(false);
    expect(
      evaluateColdStorageEligibility({
        record: base,
        config,
        live: true,
        transcriptExists: true,
      }),
    ).toMatchObject({ reason: 'live' });
    expect(
      evaluateColdStorageEligibility({
        record: { ...base, isPinned: true },
        config,
        live: false,
        transcriptExists: true,
      }),
    ).toMatchObject({ reason: 'pinned' });
    expect(
      evaluateColdStorageEligibility({
        record: { ...base, archivedAt: '2026-08-11T00:00:00.000Z' },
        config,
        live: false,
        transcriptExists: true,
        now: new Date('2026-08-12T00:00:00.000Z'),
      }),
    ).toMatchObject({ reason: 'too-young' });
    expect(
      evaluateColdStorageEligibility({
        record: { ...base, storage: { state: 'offloaded' } },
        config,
        live: false,
        transcriptExists: false,
        ignoreAge: true,
      }),
    ).toMatchObject({ reason: 'not-local' });
  });
});

describe('cold storage plan digest', () => {
  it('is stable for the same targets and changes when a hash changes', () => {
    const first = createColdStorageConfirmationDigest({
      planId: 'cold-1',
      packOutputDir: '/tmp/packs',
      targets: [{ sessionId: 'ses_1', transcriptSha256: 'aaa' }],
    });
    const same = createColdStorageConfirmationDigest({
      planId: 'cold-1',
      packOutputDir: '/tmp/packs',
      targets: [{ sessionId: 'ses_1', transcriptSha256: 'aaa' }],
    });
    const changed = createColdStorageConfirmationDigest({
      planId: 'cold-1',
      packOutputDir: '/tmp/packs',
      targets: [{ sessionId: 'ses_1', transcriptSha256: 'bbb' }],
    });
    expect(first).toBe(same);
    expect(changed).not.toBe(first);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('cold storage offload / restore / recover', () => {
  it('offloads only payload files and restores the session body', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-cold-happy-'));
    const sessionId = 'ses_happy';
    const fixture = await seedLocalSession(rootDir, sessionId);
    const hashes = await planHashes(fixture);
    const result = await offloadSessionPayload({
      rootDir,
      indexPath: fixture.indexPath,
      record: fixture.record,
      transcriptPath: fixture.transcriptPath,
      mediaDir: fixture.mediaDir,
      stagingDir: fixture.stagingDir,
      outputDir: fixture.outputDir,
      expectedTranscriptSha256: hashes.transcriptSha256,
      ...(hashes.mediaTreeSha256 ? { expectedMediaTreeSha256: hashes.mediaTreeSha256 } : {}),
    });

    expect(await pathExists(fixture.transcriptPath)).toBe(false);
    expect(await pathExists(fixture.mediaDir)).toBe(false);
    expect(await readFile(join(rootDir, 'sessions', sessionId, 'plan.json'), 'utf8')).toContain(
      'keep me',
    );
    const stub = await getSessionRecord(fixture.indexPath, sessionId);
    expect(stub?.storage?.state).toBe('offloaded');
    expect(stub?.storage?.packPath).toBe(result.packPath);

    const restored = await restoreSessionPayload({
      rootDir,
      indexPath: fixture.indexPath,
      sessionId,
      packPath: result.packPath,
      transcriptPath: fixture.transcriptPath,
      mediaDir: fixture.mediaDir,
    });
    expect(restored.createdIndexRecord).toBe(false);
    expect(await pathExists(fixture.transcriptPath)).toBe(true);
    expect(await pathExists(join(fixture.mediaDir, 'note.txt'))).toBe(true);
    const local = await getSessionRecord(fixture.indexPath, sessionId);
    expect(local?.storage).toBeUndefined();
  });

  it('leaves local payload untouched when publish is aborted', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-cold-abort-'));
    const sessionId = 'ses_abort';
    const fixture = await seedLocalSession(rootDir, sessionId);
    const hashed = await hashSessionPayload({
      transcriptPath: fixture.transcriptPath,
      mediaDir: fixture.mediaDir,
    });
    await expect(
      offloadSessionPayload({
        rootDir,
        indexPath: fixture.indexPath,
        record: fixture.record,
        transcriptPath: fixture.transcriptPath,
        mediaDir: fixture.mediaDir,
        stagingDir: fixture.stagingDir,
        outputDir: fixture.outputDir,
        expectedTranscriptSha256: hashed.transcriptSha256,
        ...(hashed.mediaTreeSha256 ? { expectedMediaTreeSha256: hashed.mediaTreeSha256 } : {}),
        hooks: {
          beforePublish: async () => {
            throw new Error('simulated publish failure');
          },
        },
      }),
    ).rejects.toThrow(/simulated publish failure/);
    expect(await pathExists(fixture.transcriptPath)).toBe(true);
    expect(await readFile(join(fixture.mediaDir, 'note.txt'), 'utf8')).toBe('media\n');
    expect((await getSessionRecord(fixture.indexPath, sessionId))?.storage).toBeUndefined();
  });

  it('refuses to move payload when local hashes go stale after publish', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-cold-stale-'));
    const sessionId = 'ses_stale';
    const fixture = await seedLocalSession(rootDir, sessionId);
    const hashes = await planHashes(fixture);
    await expect(
      offloadSessionPayload({
        rootDir,
        indexPath: fixture.indexPath,
        record: fixture.record,
        transcriptPath: fixture.transcriptPath,
        mediaDir: fixture.mediaDir,
        stagingDir: fixture.stagingDir,
        outputDir: fixture.outputDir,
        expectedTranscriptSha256: hashes.transcriptSha256,
        ...(hashes.mediaTreeSha256 ? { expectedMediaTreeSha256: hashes.mediaTreeSha256 } : {}),
        hooks: {
          mutateLocalAfterPublish: async () => {
            await writeFile(join(fixture.mediaDir, 'extra.txt'), 'changed\n', 'utf8');
          },
        },
      }),
    ).rejects.toBeInstanceOf(SessionPackStaleError);
    expect(await pathExists(fixture.transcriptPath)).toBe(true);
    expect((await getSessionRecord(fixture.indexPath, sessionId))?.storage).toBeUndefined();
  });

  it('restores quarantine when payload moved but index is still local', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-cold-crash-move-'));
    const sessionId = 'ses_crash_move';
    const fixture = await seedLocalSession(rootDir, sessionId);
    const hashes = await planHashes(fixture);
    await expect(
      offloadSessionPayload({
        rootDir,
        indexPath: fixture.indexPath,
        record: fixture.record,
        transcriptPath: fixture.transcriptPath,
        mediaDir: fixture.mediaDir,
        stagingDir: fixture.stagingDir,
        outputDir: fixture.outputDir,
        expectedTranscriptSha256: hashes.transcriptSha256,
        ...(hashes.mediaTreeSha256 ? { expectedMediaTreeSha256: hashes.mediaTreeSha256 } : {}),
        hooks: {
          afterPayloadMoved: async () => {
            throw new Error('crash after payload-moved');
          },
        },
      }),
    ).rejects.toThrow(/crash after payload-moved/);
    expect(await pathExists(fixture.transcriptPath)).toBe(false);

    const recovered = await recoverJournaledColdStorageTransactions({
      rootDir,
      indexPath: fixture.indexPath,
      resolvePaths: () => ({
        transcriptPath: fixture.transcriptPath,
        mediaDir: fixture.mediaDir,
      }),
    });
    expect(recovered.recovered.some((item) => item.action === 'restore-quarantine-local-authority')).toBe(
      true,
    );
    expect(await pathExists(fixture.transcriptPath)).toBe(true);
    expect((await getSessionRecord(fixture.indexPath, sessionId))?.storage).toBeUndefined();
  });

  it('drops quarantine when index is already offloaded', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-cold-crash-index-'));
    const sessionId = 'ses_crash_index';
    const fixture = await seedLocalSession(rootDir, sessionId);
    const hashes = await planHashes(fixture);
    await expect(
      offloadSessionPayload({
        rootDir,
        indexPath: fixture.indexPath,
        record: fixture.record,
        transcriptPath: fixture.transcriptPath,
        mediaDir: fixture.mediaDir,
        stagingDir: fixture.stagingDir,
        outputDir: fixture.outputDir,
        expectedTranscriptSha256: hashes.transcriptSha256,
        ...(hashes.mediaTreeSha256 ? { expectedMediaTreeSha256: hashes.mediaTreeSha256 } : {}),
        hooks: {
          afterIndexed: async () => {
            throw new Error('crash after indexed');
          },
        },
      }),
    ).rejects.toThrow(/crash after indexed/);

    const recovered = await recoverJournaledColdStorageTransactions({
      rootDir,
      indexPath: fixture.indexPath,
      resolvePaths: () => ({
        transcriptPath: fixture.transcriptPath,
        mediaDir: fixture.mediaDir,
      }),
    });
    expect(recovered.recovered.some((item) => item.action === 'drop-quarantine-after-index')).toBe(
      true,
    );
    expect((await getSessionRecord(fixture.indexPath, sessionId))?.storage?.state).toBe('offloaded');
    expect(await pathExists(fixture.transcriptPath)).toBe(false);
  });

  it('refuses restore over an existing local body', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-cold-conflict-'));
    const sessionId = 'ses_conflict';
    const fixture = await seedLocalSession(rootDir, sessionId);
    const hashes = await planHashes(fixture);
    const packed = await offloadSessionPayload({
      rootDir,
      indexPath: fixture.indexPath,
      record: fixture.record,
      transcriptPath: fixture.transcriptPath,
      mediaDir: fixture.mediaDir,
      stagingDir: fixture.stagingDir,
      outputDir: fixture.outputDir,
      expectedTranscriptSha256: hashes.transcriptSha256,
      ...(hashes.mediaTreeSha256 ? { expectedMediaTreeSha256: hashes.mediaTreeSha256 } : {}),
    });
    await restoreSessionPayload({
      rootDir,
      indexPath: fixture.indexPath,
      sessionId,
      packPath: packed.packPath,
      transcriptPath: fixture.transcriptPath,
      mediaDir: fixture.mediaDir,
    });
    await expect(
      restoreSessionPayload({
        rootDir,
        indexPath: fixture.indexPath,
        sessionId,
        packPath: packed.packPath,
        transcriptPath: fixture.transcriptPath,
        mediaDir: fixture.mediaDir,
      }),
    ).rejects.toBeInstanceOf(SessionStorageConflictError);
  });

  it('imports a pack when the index stub is missing', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-cold-import-'));
    const sessionId = 'ses_import';
    const fixture = await seedLocalSession(rootDir, sessionId);
    const hashes = await planHashes(fixture);
    const packed = await offloadSessionPayload({
      rootDir,
      indexPath: fixture.indexPath,
      record: fixture.record,
      transcriptPath: fixture.transcriptPath,
      mediaDir: fixture.mediaDir,
      stagingDir: fixture.stagingDir,
      outputDir: fixture.outputDir,
      expectedTranscriptSha256: hashes.transcriptSha256,
      ...(hashes.mediaTreeSha256 ? { expectedMediaTreeSha256: hashes.mediaTreeSha256 } : {}),
    });
    const otherRoot = await mkdtemp(join(tmpdir(), 'piwin-cold-import-target-'));
    const otherIndex = join(otherRoot, 'sessions-index', 'index.json');
    const imported = await restoreSessionPayload({
      rootDir: otherRoot,
      indexPath: otherIndex,
      sessionId,
      packPath: packed.packPath,
      transcriptPath: join(otherRoot, 'sessions', sessionId, 'transcript.sqlite3'),
      mediaDir: join(otherRoot, 'media', sessionId),
    });
    expect(imported.createdIndexRecord).toBe(true);
    const record = await getSessionRecord(otherIndex, sessionId);
    expect(record?.name).toBe('Cold session');
    expect(record?.storage).toBeUndefined();
  });

  it('marks unreadable offloaded packs as missing-pack', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-cold-missing-'));
    const sessionId = 'ses_missing';
    const record = createSessionRecord({
      id: sessionId,
      projectPath: '/tmp/project',
      name: 'Gone pack',
      kind: 'main',
    });
    record.isArchived = true;
    record.storage = {
      state: 'offloaded',
      packId: 'pack-missing',
      packPath: join(rootDir, 'no-such.piwin-pack'),
    };
    const indexPath = join(rootDir, 'sessions-index', 'index.json');
    await upsertSessionRecord(indexPath, record);
    const result = await reconcileSessionColdStorage({
      rootDir,
      indexPath,
      resolvePaths: () => ({
        transcriptPath: join(rootDir, 'sessions', sessionId, 'transcript.sqlite3'),
        mediaDir: join(rootDir, 'media', sessionId),
      }),
    });
    expect(result.updatedSessionIds).toContain(sessionId);
    expect((await getSessionRecord(indexPath, sessionId))?.storage?.state).toBe('missing-pack');
    expect(result.reports.some((item) => item.kind === 'missing-pack')).toBe(true);
  });

  it('lists residual journals', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-cold-journal-'));
    const journal = await createColdStorageJournal({
      rootDir,
      kind: 'offload',
      sessionId: 'ses_journal',
    });
    await updateColdStorageJournalPhase(rootDir, journal, 'published');
    const listed = await listColdStorageJournals(rootDir);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.phase).toBe('published');
    expect(getColdStorageQuarantineDir(rootDir, journal.transactionId)).toContain(
      journal.transactionId,
    );
  });
});
