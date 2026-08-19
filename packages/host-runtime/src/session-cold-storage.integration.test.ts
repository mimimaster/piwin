import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  SessionColdStorageExecuteResult,
  SessionColdStoragePlan,
  SessionColdStorageRestoreResult,
} from '@piwin/contracts';
import {
  createSessionRecord,
  openSessionTranscriptStore,
  upsertSessionRecord,
  USER_AUTHORED_GENERATION,
  checkpointTranscriptWal,
} from '@piwin/session';
import { HostRuntime } from './host-runtime.js';
import { createDefaultPiwinConfig, savePiwinConfig } from './config-store.js';
import {
  getPiwinSessionIndexPath,
  getPiwinSessionMediaDir,
  getPiwinSessionTranscriptDatabasePath,
} from './paths.js';

async function expectMissing(path: string): Promise<void> {
  await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
}

describe('HostRuntime cold storage loop', () => {
  it('plans, offloads, blocks resume, then restores', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-cold-'));
    const outputDir = await mkdtemp(join(tmpdir(), 'piwin-host-cold-out-'));
    const sessionId = 'ses_host_cold';
    const config = createDefaultPiwinConfig();
    config.session = {
      autoName: true,
      coldStorage: {
        enabled: true,
        packOutputDir: outputDir,
        minArchivedAgeDays: 1,
      },
    };
    await savePiwinConfig(config, rootDir);

    const record = createSessionRecord({
      id: sessionId,
      projectPath: '',
      scope: { kind: 'general' },
      name: 'Host cold',
      kind: 'main',
    });
    record.isArchived = true;
    record.archivedAt = '2026-06-01T00:00:00.000Z';
    await upsertSessionRecord(getPiwinSessionIndexPath(rootDir), record);
    await mkdir(join(rootDir, 'sessions', sessionId), { recursive: true });
    const dbPath = getPiwinSessionTranscriptDatabasePath(rootDir, sessionId);
    const store = await openSessionTranscriptStore({
      dbPath,
      sessionId,
      projectPath: '',
    });
    await store.appendMessage({
      id: 'msg_1',
      runtimeGenerationId: USER_AUTHORED_GENERATION,
      backendMessageId: 'b1',
      role: 'user',
      text: 'host offload me',
      status: 'done',
      createdAt: new Date().toISOString(),
    });
    store.close();
    await checkpointTranscriptWal(dbPath);
    await mkdir(getPiwinSessionMediaDir(rootDir, sessionId), { recursive: true });
    await writeFile(join(getPiwinSessionMediaDir(rootDir, sessionId), 'a.txt'), 'a\n', 'utf8');

    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    try {
      const planned = await runtime.handleCommand({
        type: 'session/cold-storage-plan',
        sessionIds: [sessionId],
      });
      expect(planned.success).toBe(true);
      if (!planned.success) throw new Error(planned.error);
      const plan = planned.data as SessionColdStoragePlan;
      expect(plan.targets).toHaveLength(1);

      const executed = await runtime.handleCommand({
        type: 'session/cold-storage-execute',
        planId: plan.planId,
        confirmationDigest: plan.confirmationDigest,
      });
      expect(executed.success).toBe(true);
      if (!executed.success) throw new Error(executed.error);
      const result = executed.data as SessionColdStorageExecuteResult;
      expect(result.offloaded).toHaveLength(1);
      await expectMissing(dbPath);

      const resume = await runtime.handleCommand({ type: 'session/resume', sessionId });
      expect(resume.success).toBe(false);
      expect(resume.success ? '' : resume.error).toContain('session-body-offloaded');

      const restored = await runtime.handleCommand({
        type: 'session/cold-storage-restore',
        sessionId,
      });
      expect(restored.success).toBe(true);
      if (!restored.success) throw new Error(restored.error);
      expect((restored.data as SessionColdStorageRestoreResult).storage.state).toBe('local');

      const resumed = await runtime.handleCommand({ type: 'session/resume', sessionId });
      expect(resumed.success).toBe(true);
    } finally {
      await runtime.dispose();
    }
  });
});
