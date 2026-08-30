import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostStatusData, SessionContextSnapshot, SessionResumeData } from '@piwin/contracts';
import { HostRuntime } from '../host-runtime.js';
import { getPiwinSessionIndexPath, getPiwinSessionTranscriptPath } from '../paths.js';

async function writeDurableSession(rootDir: string, sessionId: string): Promise<void> {
  const projectPath = '/tmp/context-get-project';
  await mkdir(join(rootDir, 'sessions-index'), { recursive: true });
  await mkdir(join(rootDir, 'sessions', sessionId), { recursive: true });
  await writeFile(
    getPiwinSessionIndexPath(rootDir),
    `${JSON.stringify({
      version: 1,
      sessions: [
        {
          id: sessionId,
          projectPath,
          name: 'Durable session',
          createdAt: '2026-08-30T00:00:00.000Z',
          updatedAt: '2026-08-30T00:00:00.000Z',
          messageCount: 0,
        },
      ],
    })}\n`,
    'utf8',
  );
  await writeFile(
    getPiwinSessionTranscriptPath(rootDir, sessionId),
    `${JSON.stringify({
      version: 1,
      sessionId,
      projectPath,
      messages: [],
      updatedAt: '2026-08-30T00:00:00.000Z',
    })}\n`,
    'utf8',
  );
}

describe('session/context-get and resume unknown snapshots', () => {
  it('returns an explicit unknown snapshot without allocating a Pi runtime', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-context-get-'));
    const sessionId = 'durable-context-session';
    await writeDurableSession(rootDir, sessionId);
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    try {
      const response = await runtime.handleCommand({
        type: 'session/context-get',
        sessionId,
      });
      expect(response.success).toBe(true);
      if (!response.success) throw new Error(response.error);
      const snapshot = response.data as SessionContextSnapshot;
      expect(snapshot.sessionId).toBe(sessionId);
      expect(snapshot.occupancy.kind).toBe('unknown');
      expect(snapshot.revision).toBeGreaterThanOrEqual(1);

      const status = await runtime.handleCommand({ type: 'host/status' });
      expect(status.success).toBe(true);
      if (!status.success) throw new Error(status.error);
      const data = status.data as HostStatusData;
      expect(data.activeSessionIds).not.toContain(sessionId);
      expect(data.capabilities.contextTelemetryVersion).toBe(1);
    } finally {
      await runtime.dispose();
    }
  });

  it('includes contextSnapshot and lastRequestUsage on resume even when unknown/null', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-context-resume-'));
    const sessionId = 'durable-resume-session';
    await writeDurableSession(rootDir, sessionId);
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    try {
      const response = await runtime.handleCommand({ type: 'session/resume', sessionId });
      expect(response.success).toBe(true);
      if (!response.success) throw new Error(response.error);
      const resume = response.data as SessionResumeData;
      expect(resume.live).toBe(false);
      expect(resume).toHaveProperty('contextSnapshot');
      expect(resume).toHaveProperty('lastRequestUsage');
      expect(resume.contextSnapshot.occupancy.kind).toBe('unknown');
      expect(resume.lastRequestUsage).toBeNull();
    } finally {
      await runtime.dispose();
    }
  });
});
