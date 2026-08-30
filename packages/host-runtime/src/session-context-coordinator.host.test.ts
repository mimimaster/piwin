import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostPush, SessionContextSnapshot, SessionResumeData } from '@piwin/contracts';
import { loadUsageRecords } from '@piwin/session';
import { HostRuntime } from './host-runtime.js';
import { getPiwinUsageLedgerPath } from './paths.js';
import type { SessionContextCoordinator } from './session-context-coordinator.js';

async function waitForPushType(pushes: HostPush[], type: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (pushes.some((push) => push.type === type)) return;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
  }
  throw new Error(`Timed out waiting for push type ${type}`);
}

function coordinatorOf(runtime: HostRuntime): SessionContextCoordinator {
  const coordinator = (
    runtime as unknown as { sessionContextCoordinator: SessionContextCoordinator }
  ).sessionContextCoordinator;
  if (!coordinator) {
    throw new Error('session context coordinator is not installed');
  }
  return coordinator;
}

function generationOf(runtime: HostRuntime, sessionId: string): string {
  const generationId = (
    runtime as unknown as {
      runtimeController: { getStatus: (id: string) => { generationId?: string } };
    }
  ).runtimeController.getStatus(sessionId).generationId;
  if (generationId === undefined) {
    throw new Error(`no runtime generation for ${sessionId}`);
  }
  return generationId;
}

describe('session context coordinator host commands', () => {
  it('mock prompt samples persist through resume and do not extra-bill (T14 host)', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-context-host-'));
    const pushes: HostPush[] = [];
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
      onPush: (message) => {
        pushes.push(message);
      },
    });
    try {
      const created = await runtime.handleCommand({
        type: 'session/create',
        input: { projectPath: '/tmp/context-host-project' },
      });
      expect(created.success).toBe(true);
      if (!created.success) throw new Error(created.error);
      const sessionId = (created.data as { sessionId: string }).sessionId;
      const prompted = await runtime.handleCommand({
        type: 'session/prompt',
        sessionId,
        input: { text: 'hello context coordinator' },
      });
      expect(prompted, JSON.stringify(prompted)).toMatchObject({ success: true });
      await waitForPushType(pushes, 'run/terminal');
      await runtime.flushUsageLedgerWrites();
      const ledgerPath = getPiwinUsageLedgerPath(rootDir);
      const baselineRows = await loadUsageRecords(ledgerPath);
      const baselineHooks = pushes.filter(
        (push) =>
          push.type === 'host/log' &&
          typeof push.message === 'string' &&
          push.message.includes('turn_end'),
      ).length;

      const coordinator = coordinatorOf(runtime);
      const generationId = generationOf(runtime, sessionId);
      const live = await coordinator.getSnapshot(sessionId);
      const leaf = live.contextBoundary.activeLeafMessageId;
      for (let index = 0; index < 100; index += 1) {
        await coordinator.ingestMeasurement({
          sessionId,
          boundGenerationId: generationId,
          measurement: {
            sessionId,
            runtimeGenerationId: generationId,
            sampleSequence: index + 1,
            occupancy: {
              kind: 'known',
              tokensUsed: 2_000 + index,
              quality: 'measured',
              coverage: 'complete',
              basis: 'host-test',
              sampledAt: new Date().toISOString(),
            },
            contextBoundary: { activeLeafMessageId: leaf },
            sampledAt: new Date().toISOString(),
          },
        });
      }
      await coordinator.flush(sessionId);
      await runtime.flushUsageLedgerWrites();
      const afterSampleRows = await loadUsageRecords(ledgerPath);
      expect(afterSampleRows).toHaveLength(baselineRows.length);
      const afterSampleHooks = pushes.filter(
        (push) =>
          push.type === 'host/log' &&
          typeof push.message === 'string' &&
          push.message.includes('turn_end'),
      ).length;
      expect(afterSampleHooks).toBe(baselineHooks);

      const resumed = await runtime.handleCommand({ type: 'session/resume', sessionId });
      expect(resumed.success).toBe(true);
      if (!resumed.success) throw new Error(resumed.error);
      const resume = resumed.data as SessionResumeData;
      expect(resume.contextSnapshot.occupancy).toMatchObject({
        kind: 'known',
        tokensUsed: 2_099,
      });
      expect(resume.lastRequestUsage === null || resume.lastRequestUsage.sessionId === sessionId).toBe(
        true,
      );
    } finally {
      await runtime.dispose();
    }
  }, 20_000);

  it('session/context-get reads coordinator snapshot without allocating a runtime', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-context-get-live-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    try {
      const created = await runtime.handleCommand({
        type: 'session/create',
        input: { projectPath: '/tmp/context-get-live' },
      });
      expect(created.success).toBe(true);
      if (!created.success) throw new Error(created.error);
      const sessionId = (created.data as { sessionId: string }).sessionId;
      const coordinator = coordinatorOf(runtime);
      await coordinator.noteResponseEvidence({ sessionId, messageId: 'msg-1' });
      await coordinator.ingestMeasurement({
        sessionId,
        measurement: {
          sessionId,
          sampleSequence: 1,
          occupancy: {
            kind: 'known',
            tokensUsed: 1_234,
            quality: 'estimated',
            coverage: 'partial',
            basis: 'host-get',
            sampledAt: new Date().toISOString(),
          },
          contextBoundary: { activeLeafMessageId: 'msg-1' },
          sampledAt: new Date().toISOString(),
        },
      });
      await coordinator.flush(sessionId);
      await runtime.disposeLiveSession(sessionId);
      const response = await runtime.handleCommand({ type: 'session/context-get', sessionId });
      expect(response.success).toBe(true);
      if (!response.success) throw new Error(response.error);
      const snapshot = response.data as SessionContextSnapshot;
      expect(snapshot.occupancy).toMatchObject({ kind: 'known', tokensUsed: 1_234 });
    } finally {
      await runtime.dispose();
    }
  });
});
