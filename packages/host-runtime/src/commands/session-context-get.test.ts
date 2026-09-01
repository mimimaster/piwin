import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostStatusData, SessionContextSnapshot, SessionResumeData } from '@piwin/contracts';
import { openSessionTranscriptStore } from '@piwin/session';
import { HostRuntime } from '../host-runtime.js';
import {
  getPiwinSessionIndexPath,
  getPiwinSessionTranscriptDatabasePath,
  getPiwinSessionTranscriptPath,
} from '../paths.js';

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

  it('resume and context-get promote a dirty waiting-for-response snapshot', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-context-dirty-'));
    const sessionId = 'durable-dirty-session';
    await writeDurableSession(rootDir, sessionId);
    const leaf = { activeLeafMessageId: 'leaf-resume' };
    const occupancy = {
      kind: 'known' as const,
      tokensUsed: 23_065,
      tokensLimit: 128_000,
      quality: 'measured' as const,
      coverage: 'complete' as const,
      basis: 'current-request',
      sampledAt: '2026-08-30T00:00:00.000Z',
    };
    const store = await openSessionTranscriptStore({
      dbPath: getPiwinSessionTranscriptDatabasePath(rootDir, sessionId),
      sessionId,
      projectPath: '/tmp/context-get-project',
    });
    const written = await store.replaceContextState({
      expectedContextVersion: 1,
      expectedBoundary: leaf,
      snapshot: {
        sessionId,
        revision: 1,
        contextVersion: 1,
        contextBoundary: leaf,
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: true,
        },
        phase: 'idle',
        occupancy: { kind: 'unknown', reason: 'waiting-for-response' },
        lastConfirmed: {
          occupancy,
          contextBoundary: leaf,
          sampledAt: '2026-08-30T00:00:00.000Z',
        },
        updatedAt: '2026-08-30T00:00:00.000Z',
      },
    });
    expect(written.ok).toBe(true);
    store.close();

    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    try {
      const getResponse = await runtime.handleCommand({
        type: 'session/context-get',
        sessionId,
      });
      expect(getResponse.success).toBe(true);
      if (!getResponse.success) throw new Error(getResponse.error);
      const snapshot = getResponse.data as SessionContextSnapshot;
      expect(snapshot.occupancy).toMatchObject({ kind: 'known', tokensUsed: 23_065 });

      const resumeResponse = await runtime.handleCommand({ type: 'session/resume', sessionId });
      expect(resumeResponse.success).toBe(true);
      if (!resumeResponse.success) throw new Error(resumeResponse.error);
      const resume = resumeResponse.data as SessionResumeData;
      expect(resume.contextSnapshot.occupancy).toMatchObject({
        kind: 'known',
        tokensUsed: 23_065,
      });
    } finally {
      await runtime.dispose();
    }
  });

  it('resume and context-get do not promote runtime-generation-mismatch with a moved leaf', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-context-mismatch-'));
    const sessionId = 'durable-mismatch-session';
    await writeDurableSession(rootDir, sessionId);
    const occupancy = {
      kind: 'known' as const,
      tokensUsed: 7_797,
      tokensLimit: 128_000,
      quality: 'measured' as const,
      coverage: 'complete' as const,
      basis: 'current-request',
      sampledAt: '2026-09-01T08:23:05.531Z',
    };
    const store = await openSessionTranscriptStore({
      dbPath: getPiwinSessionTranscriptDatabasePath(rootDir, sessionId),
      sessionId,
      projectPath: '/tmp/context-get-project',
    });
    const written = await store.replaceContextState({
      expectedContextVersion: 1,
      expectedBoundary: { activeLeafMessageId: 'voice-live-leaf' },
      snapshot: {
        sessionId,
        revision: 1,
        contextVersion: 3,
        contextBoundary: { activeLeafMessageId: 'voice-live-leaf' },
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: true,
        },
        phase: 'invalidated',
        occupancy: { kind: 'unknown', reason: 'runtime-generation-mismatch' },
        lastConfirmed: {
          occupancy,
          contextBoundary: { activeLeafMessageId: 'piw-old-leaf' },
          sampledAt: '2026-09-01T08:23:05.531Z',
        },
        updatedAt: '2026-09-01T08:23:37.011Z',
      },
    });
    expect(written.ok).toBe(true);
    store.close();

    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    try {
      const getResponse = await runtime.handleCommand({
        type: 'session/context-get',
        sessionId,
      });
      expect(getResponse.success).toBe(true);
      if (!getResponse.success) throw new Error(getResponse.error);
      const snapshot = getResponse.data as SessionContextSnapshot;
      expect(snapshot.occupancy).toEqual({
        kind: 'unknown',
        reason: 'runtime-generation-mismatch',
      });
      expect(snapshot.phase).toBe('invalidated');

      const resumeResponse = await runtime.handleCommand({ type: 'session/resume', sessionId });
      expect(resumeResponse.success).toBe(true);
      if (!resumeResponse.success) throw new Error(resumeResponse.error);
      const resume = resumeResponse.data as SessionResumeData;
      expect(resume.contextSnapshot.occupancy).toEqual({
        kind: 'unknown',
        reason: 'runtime-generation-mismatch',
      });
      expect(resume.contextSnapshot.phase).toBe('invalidated');
    } finally {
      await runtime.dispose();
    }
  });
});
