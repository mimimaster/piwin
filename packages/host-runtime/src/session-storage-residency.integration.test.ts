import { access, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SESSION_BODY_OFFLOADED,
  SESSION_PACK_MISSING,
  type SessionListPageData,
  type SessionSearchResult,
  type SessionSummary,
} from '@piwin/contracts';
import { createSessionRecord, upsertSessionRecord } from '@piwin/session';
import { HostRuntime } from './host-runtime.js';
import { getPiwinSessionIndexPath, getPiwinSessionTranscriptDatabasePath } from './paths.js';

async function seedStub(input: {
  rootDir: string;
  sessionId: string;
  name: string;
  state: 'offloaded' | 'missing-pack';
}): Promise<void> {
  const record = createSessionRecord({
    id: input.sessionId,
    projectPath: '',
    scope: { kind: 'general' },
    workingDirectory: '',
    name: input.name,
    kind: 'main',
  });
  record.isArchived = true;
  record.archivedAt = '2026-08-01T00:00:00.000Z';
  record.storage = {
    state: input.state,
    packId: `${input.sessionId}-pack`,
    packPath: `/tmp/packs/${input.sessionId}.piwin-pack`,
    coldPreview: input.name,
  };
  await mkdir(join(input.rootDir, 'sessions-index'), { recursive: true });
  await upsertSessionRecord(getPiwinSessionIndexPath(input.rootDir), record);
}

async function expectMissingSqlite(rootDir: string, sessionId: string): Promise<void> {
  await expect(access(getPiwinSessionTranscriptDatabasePath(rootDir, sessionId))).rejects.toMatchObject(
    { code: 'ENOENT' },
  );
}

function errorOf(response: { success: boolean; error?: string }): string {
  return response.success ? '' : (response.error ?? '');
}

describe('session storage residency guards', () => {
  it('lists and searches offloaded stubs while blocking body access without creating sqlite', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-storage-offloaded-'));
    const sessionId = 'ses_offloaded_guard';
    await seedStub({
      rootDir,
      sessionId,
      name: 'Cold Offloaded Chat',
      state: 'offloaded',
    });
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    try {
      const listed = await runtime.handleCommand({
        type: 'session/list',
        scope: { kind: 'general' },
        includeArchived: true,
      });
      expect(listed.success).toBe(true);
      if (!listed.success) throw new Error(listed.error);
      const sessions = (listed.data as { sessions: SessionSummary[] }).sessions;
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.storage?.state).toBe('offloaded');
      expect(sessions[0]?.storage?.packId).toBe(`${sessionId}-pack`);

      const page = await runtime.handleCommand({
        type: 'session/list-page',
        query: {
          scope: { kind: 'general' },
          lifecycle: 'archived',
          order: 'updated',
          limit: 20,
        },
      });
      expect(page.success).toBe(true);
      if (!page.success) throw new Error(page.error);
      const pageData = page.data as SessionListPageData;
      expect(pageData.status).toBe('page');
      if (pageData.status === 'page') {
        expect(pageData.sessions[0]?.storage?.state).toBe('offloaded');
      }

      const renamed = await runtime.handleCommand({
        type: 'session/rename',
        sessionId,
        name: 'Renamed Cold Chat',
      });
      expect(renamed.success).toBe(true);

      const pinned = await runtime.handleCommand({ type: 'session/pin', sessionId });
      expect(pinned.success).toBe(true);

      const searched = await runtime.handleCommand({
        type: 'session/search',
        query: { query: 'Cold', scope: { kind: 'general' }, lifecycle: 'archived' },
      });
      expect(searched.success).toBe(true);
      if (!searched.success) throw new Error(searched.error);
      const hits = (searched.data as SessionSearchResult).hits;
      expect(hits[0]?.sessionId).toBe(sessionId);
      expect(hits[0]?.storage?.state).toBe('offloaded');

      const status = await runtime.handleCommand({
        type: 'session/runtime-status',
        sessionId,
      });
      expect(status.success).toBe(true);

      const rejected = [
        await runtime.handleCommand({ type: 'session/resume', sessionId }),
        await runtime.handleCommand({
          type: 'session/prompt',
          sessionId,
          input: { text: 'should not run' },
        }),
        await runtime.handleCommand({
          type: 'session/transcript-page',
          query: { sessionId, limit: 20, maximumBytes: 16_384 },
        }),
        await runtime.handleCommand({ type: 'session/messages', sessionId }),
        await runtime.handleCommand({ type: 'session/export', sessionId, format: 'md' }),
        await runtime.handleCommand({
          type: 'session/truncate-from',
          sessionId,
          messageId: 'msg-1',
        }),
        await runtime.handleCommand({ type: 'session/duplicate', sessionId }),
        await runtime.handleCommand({
          type: 'session/fork',
          sessionId,
          messageId: 'msg-1',
          workspaceStrategy: 'shared',
        }),
        await runtime.handleCommand({ type: 'session/unarchive', sessionId }),
        await runtime.handleCommand({ type: 'session/delete', sessionId, force: true }),
      ];
      for (const response of rejected) {
        expect(response.success, JSON.stringify(response)).toBe(false);
        expect(errorOf(response)).toContain(SESSION_BODY_OFFLOADED);
      }

      await expectMissingSqlite(rootDir, sessionId);
    } finally {
      await runtime.dispose();
    }
  });

  it('uses session-pack-missing for missing-pack stubs and still never creates sqlite', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-storage-missing-pack-'));
    const sessionId = 'ses_missing_pack_guard';
    await seedStub({
      rootDir,
      sessionId,
      name: 'Missing Pack Chat',
      state: 'missing-pack',
    });
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    try {
      const resume = await runtime.handleCommand({ type: 'session/resume', sessionId });
      expect(resume.success).toBe(false);
      expect(errorOf(resume)).toContain(SESSION_PACK_MISSING);

      const prompt = await runtime.handleCommand({
        type: 'session/prompt',
        sessionId,
        input: { text: 'should not run' },
      });
      expect(prompt.success).toBe(false);
      expect(errorOf(prompt)).toContain(SESSION_PACK_MISSING);

      await expectMissingSqlite(rootDir, sessionId);
    } finally {
      await runtime.dispose();
    }
  });
});
