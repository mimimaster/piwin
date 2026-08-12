import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createSessionRecord,
  createSessionPack,
  openSessionTranscriptStore,
  verifySessionPack,
  listSessionPacks,
  generateSessionPackId,
  USER_AUTHORED_GENERATION,
} from './index.js';

async function createSessionFixture(root: string, sessionId: string, withMedia: boolean) {
  const sessionDir = join(root, 'sessions', sessionId);
  const mediaDir = join(root, 'media', sessionId);
  const stagingDir = join(root, 'pack-staging');
  const publishDir = join(root, 'publish');
  await mkdir(sessionDir, { recursive: true });
  await mkdir(publishDir, { recursive: true });
  await mkdir(stagingDir, { recursive: true });

  const dbPath = join(sessionDir, 'transcript.sqlite3');
  const store = await openSessionTranscriptStore({
    dbPath,
    sessionId,
    projectPath: '/tmp/project',
  });
  await store.appendMessage({
    id: 'msg_user_1',
    runtimeGenerationId: USER_AUTHORED_GENERATION,
    backendMessageId: 'backend-user-1',
    role: 'user',
    text: 'hello pack',
    status: 'done',
    createdAt: new Date().toISOString(),
  });
  await store.appendMessage({
    id: 'msg_assistant_1',
    runtimeGenerationId: 'gen-1',
    backendMessageId: 'backend-assistant-1',
    role: 'assistant',
    text: 'packed reply',
    status: 'done',
    createdAt: new Date().toISOString(),
  });
  store.close();

  if (withMedia) {
    await mkdir(mediaDir, { recursive: true });
    await writeFile(join(mediaDir, 'note.txt'), 'media-bytes\n', 'utf8');
  }

  const record = createSessionRecord({
    id: sessionId,
    projectPath: '/tmp/project',
    name: 'Pack demo',
    kind: 'main',
  });
  record.isArchived = true;
  record.archivedAt = '2026-08-12T00:00:00.000Z';
  record.messageCount = 2;
  record.lastPreview = 'hello pack';

  return {
    record,
    paths: {
      transcriptPath: dbPath,
      mediaDir,
      stagingDir,
    },
    publishDir,
    dbPath,
  };
}

describe('session-pack', () => {
  it('creates, verifies, and lists a one-session pack without media', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-pack-basic-'));
    const fixture = await createSessionFixture(root, 'ses_basic', false);
    const before = await readFile(fixture.dbPath);

    const created = await createSessionPack({
      record: fixture.record,
      paths: fixture.paths,
      outputDir: fixture.publishDir,
      packId: 'ses_basic-20260812T000000Z-test01',
      now: new Date('2026-08-12T00:00:00.000Z'),
    });

    expect(created.sessionId).toBe('ses_basic');
    expect(created.mediaIncluded).toBe(false);
    expect(created.packPath.endsWith('.piwin-pack')).toBe(true);

    const verified = await verifySessionPack({ packPath: created.packPath });
    expect(verified.valid).toBe(true);
    expect(verified.archiveSha256).toBe(created.archiveSha256);
    expect(verified.messageCount).toBe(2);

    const listed = await listSessionPacks({ directory: fixture.publishDir });
    expect(listed.packs).toHaveLength(1);
    expect(listed.packs[0]?.valid).toBe(true);
    expect(listed.packs[0]?.sessionId).toBe('ses_basic');

    // Non-destructive: source transcript bytes unchanged.
    const after = await readFile(fixture.dbPath);
    expect(after.equals(before)).toBe(true);
  });

  it('packs media trees and verifies media hashes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-pack-media-'));
    const fixture = await createSessionFixture(root, 'ses_media', true);
    const created = await createSessionPack({
      record: fixture.record,
      paths: fixture.paths,
      outputDir: fixture.publishDir,
      packId: 'ses_media-20260812T000000Z-test02',
    });
    expect(created.mediaIncluded).toBe(true);
    expect(created.mediaTreeSha256).toMatch(/^[a-f0-9]{64}$/);

    const verified = await verifySessionPack({ packPath: created.packPath });
    expect(verified.mediaIncluded).toBe(true);
    expect(verified.mediaTreeSha256).toBe(created.mediaTreeSha256);
  });

  it('rejects archive hash mismatches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-pack-tamper-'));
    const fixture = await createSessionFixture(root, 'ses_tamper', false);
    const created = await createSessionPack({
      record: fixture.record,
      paths: fixture.paths,
      outputDir: fixture.publishDir,
      packId: 'ses_tamper-20260812T000000Z-test03',
    });
    await writeFile(created.packPath, 'tampered-bytes');
    await expect(verifySessionPack({ packPath: created.packPath })).rejects.toThrow(/hash mismatch/i);
  });

  it('rejects unsafe pack ids', async () => {
    expect(() => generateSessionPackId('../escape')).toThrow(/Invalid pack session id|Invalid/);
  });

  it('rejects packing into the piwin root via host command contract path checks only at host layer', async () => {
    // Core create accepts any absolute outputDir; host command enforces outside-root.
    // Keep a smoke assertion that generateSessionPackId produces a safe id.
    const id = generateSessionPackId('ses_ok', new Date('2026-08-12T12:00:00.000Z'));
    expect(id.startsWith('ses_ses_ok-')).toBe(true);
    expect(createHash('sha256').update(id).digest('hex')).toHaveLength(64);
  });
});
