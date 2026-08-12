import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { HostResponse, SessionIndexRecord } from '@piwin/contracts';
import { createSessionRecord, upsertSessionRecord } from '@piwin/session';
import { getPiwinConfigPath, getPiwinSessionIndexPath } from '../paths.js';
import {
  handleSessionProductCommand,
  type SessionProductCommandContext,
} from './session-product-commands.js';

function successfulData(response: HostResponse | null): unknown {
  if (response?.success) {
    return response.data;
  }
  throw new Error(response === null ? 'missing response' : response.error);
}

function createContext(rootDir: string): SessionProductCommandContext {
  return {
    piwinRoot: rootDir,
    createSession: async () => {
      throw new Error('not used');
    },
    loadTranscriptMessages: async () => [],
    getTranscriptStore: async () => {
      throw new Error('not used');
    },
    withTranscriptStore: async () => {
      throw new Error('not used');
    },
    abortLiveSession: async () => undefined,
    disposeLiveSession: async () => undefined,
    archiveSession: async () => undefined,
    tryArchiveLifecycleCandidate: vi.fn(async (input) => ({
      status: 'archived' as const,
      record: createSessionRecord({ id: input.sessionId, projectPath: '/project' }),
    })),
    deleteSession: async () => undefined,
    bindSession: async () => undefined,
    pushStatus: () => undefined,
  };
}

async function createLifecycleRoot(): Promise<{
  rootDir: string;
  oldRecord: SessionIndexRecord;
}> {
  const rootDir = await mkdtemp(join(tmpdir(), 'piwin-lifecycle-command-'));
  await writeFile(
    getPiwinConfigPath(rootDir),
    `${JSON.stringify({ version: 1, session: { lifecycle: { archive: { maxActiveMainSessions: 1 } } } })}\n`,
    'utf8',
  );
  const oldRecord = createSessionRecord({
    id: 'old-session',
    projectPath: '/project',
    name: 'Old session',
    kind: 'main',
  });
  oldRecord.updatedAt = '2026-08-01T00:00:00.000Z';
  const newRecord = createSessionRecord({
    id: 'new-session',
    projectPath: '/project',
    name: 'New session',
    kind: 'main',
  });
  newRecord.updatedAt = '2026-08-12T00:00:00.000Z';
  const indexPath = getPiwinSessionIndexPath(rootDir);
  await upsertSessionRecord(indexPath, oldRecord);
  await upsertSessionRecord(indexPath, newRecord);
  return { rootDir, oldRecord };
}

describe('session lifecycle commands', () => {
  it('rejects stale plan ids without applying any candidate', async () => {
    const { rootDir } = await createLifecycleRoot();
    const context = createContext(rootDir);

    const response = await handleSessionProductCommand(
      { type: 'session/lifecycle-apply', planId: 'stale-plan' },
      undefined,
      context,
    );

    expect(response?.success).toBe(false);
    expect(response?.success ? '' : response?.error).toContain('Lifecycle plan is stale');
    expect(context.tryArchiveLifecycleCandidate).not.toHaveBeenCalled();
  });

  it('applies the exact previewed plan and reports per-session outcomes', async () => {
    const { rootDir, oldRecord } = await createLifecycleRoot();
    const context = createContext(rootDir);
    context.tryArchiveLifecycleCandidate = vi.fn(async () => ({ status: 'busy' as const }));
    const planResponse = await handleSessionProductCommand(
      { type: 'session/lifecycle-plan' },
      undefined,
      context,
    );
    const plan = successfulData(planResponse) as {
      planId: string;
      candidates: Array<{ sessionId: string; updatedAt: string }>;
    };

    const applyResponse = await handleSessionProductCommand(
      { type: 'session/lifecycle-apply', planId: plan.planId },
      undefined,
      context,
    );
    const result = successfulData(applyResponse) as {
      archived: string[];
      skipped: Array<{ sessionId: string; reason: string }>;
    };

    expect(plan.candidates).toEqual([
      {
        sessionId: oldRecord.id,
        updatedAt: oldRecord.updatedAt,
        reason: 'active-limit',
        name: 'Old session',
      },
    ]);
    expect(context.tryArchiveLifecycleCandidate).toHaveBeenCalledWith({
      sessionId: oldRecord.id,
      expectedUpdatedAt: oldRecord.updatedAt,
    });
    expect(result.archived).toEqual([]);
    expect(result.skipped).toEqual([{ sessionId: oldRecord.id, reason: 'busy' }]);
  });
});
