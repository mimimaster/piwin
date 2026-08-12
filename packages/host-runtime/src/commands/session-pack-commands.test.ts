import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostResponse } from '@piwin/contracts';
import {
  createSessionRecord,
  openSessionTranscriptStore,
  upsertSessionRecord,
  USER_AUTHORED_GENERATION,
} from '@piwin/session';
import {
  getPiwinSessionIndexPath,
  getPiwinSessionMediaDir,
  getPiwinSessionTranscriptDatabasePath,
  getPiwinRoot,
} from '../paths.js';
import { handleSessionPackCommand, type SessionPackCommandContext } from './session-pack-commands.js';

function data(response: HostResponse | null): unknown {
  if (response?.success) return response.data;
  throw new Error(response === null ? 'missing response' : response.error);
}

async function prepareRoot(): Promise<{ rootDir: string; sessionId: string; publishDir: string }> {
  const rootDir = await mkdtemp(join(tmpdir(), 'piwin-pack-host-'));
  const sessionId = 'ses_host_pack';
  const publishDir = await mkdtemp(join(tmpdir(), 'piwin-pack-publish-'));
  const indexPath = getPiwinSessionIndexPath(rootDir);
  const record = createSessionRecord({
    id: sessionId,
    projectPath: '/tmp/project',
    name: 'Host pack',
    kind: 'main',
  });
  record.isArchived = true;
  await upsertSessionRecord(indexPath, record);

  const dbPath = getPiwinSessionTranscriptDatabasePath(rootDir, sessionId);
  await mkdir(join(rootDir, 'sessions', sessionId), { recursive: true });
  const store = await openSessionTranscriptStore({
    dbPath,
    sessionId,
    projectPath: '/tmp/project',
  });
  await store.appendMessage({
    id: 'msg_1',
    runtimeGenerationId: USER_AUTHORED_GENERATION,
    backendMessageId: 'b1',
    role: 'user',
    text: 'pack me',
    status: 'done',
    createdAt: new Date().toISOString(),
  });
  store.close();

  // Touch media path as empty (optional).
  await mkdir(getPiwinSessionMediaDir(rootDir, sessionId), { recursive: true });
  return { rootDir, sessionId, publishDir };
}

function context(rootDir: string, live = false): SessionPackCommandContext {
  return {
    piwinRoot: rootDir,
    withTranscriptMaintenance: async (_sessionId, operation) => operation(),
    isLiveSession: () => live,
  };
}

describe('session pack commands', () => {
  it('creates and verifies a pack outside the piwin root', async () => {
    const { rootDir, sessionId, publishDir } = await prepareRoot();
    const createResponse = await handleSessionPackCommand(
      {
        type: 'session/pack-create',
        sessionId,
        outputDir: publishDir,
        packId: 'ses_host_pack-20260812T000000Z-host01',
      },
      'req-1',
      context(rootDir),
    );
    const created = data(createResponse) as { packPath: string; sessionId: string };
    expect(created.sessionId).toBe(sessionId);

    const verifyResponse = await handleSessionPackCommand(
      { type: 'session/pack-verify', packPath: created.packPath },
      'req-2',
      context(rootDir),
    );
    const verified = data(verifyResponse) as { valid: boolean; sessionId: string };
    expect(verified.valid).toBe(true);
    expect(verified.sessionId).toBe(sessionId);

    const listResponse = await handleSessionPackCommand(
      { type: 'session/pack-list', directory: publishDir },
      'req-3',
      context(rootDir),
    );
    const listed = data(listResponse) as { packs: Array<{ valid: boolean }> };
    expect(listed.packs).toHaveLength(1);
    expect(listed.packs[0]?.valid).toBe(true);
  });

  it('rejects outputDir inside the piwin root', async () => {
    const { rootDir, sessionId } = await prepareRoot();
    const inside = join(getPiwinRoot(rootDir), 'sessions');
    const response = await handleSessionPackCommand(
      {
        type: 'session/pack-create',
        sessionId,
        outputDir: inside,
      },
      undefined,
      context(rootDir),
    );
    expect(response?.success).toBe(false);
    expect(response?.success ? '' : response?.error).toMatch(/outside the piwin root/i);
  });

  it('rejects packing a live session', async () => {
    const { rootDir, sessionId, publishDir } = await prepareRoot();
    const response = await handleSessionPackCommand(
      {
        type: 'session/pack-create',
        sessionId,
        outputDir: publishDir,
      },
      undefined,
      context(rootDir, true),
    );
    expect(response?.success).toBe(false);
    expect(response?.success ? '' : response?.error).toMatch(/live/i);
  });
});
