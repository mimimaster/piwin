import { describe, expect, it, vi } from 'vitest';
import type { HostPush, SessionHandle } from '@piwin/contracts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSessionTranscriptStore } from '@piwin/session';
import { createDelayedSessionHandle } from '../delayed-session-fixture.js';
import { handleSessionLiveCommand } from './session-live-commands.js';
import { createControlContext } from './session-live-test-context.js';

describe('run intervention structured input', () => {
  it('adopts a queued turn that carries a context reference', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-intervention-refs-'));
    const baseSession = createDelayedSessionHandle();
    const armRunIntervention = vi.fn(
      async (_intervention: { text: string }) => undefined,
    );
    const session: SessionHandle = { ...baseSession, armRunIntervention };
    const control = createControlContext(session);
    control.registry.attachRuntimeGeneration(control.activeRun.runId, 'generation-1');
    const store = await openSessionTranscriptStore({
      dbPath: join(rootDir, 'transcript.sqlite3'),
      sessionId: session.id,
      projectPath: '/tmp/project',
    });
    control.context.getTranscriptStore = async () => store;
    const pushes: HostPush[] = [];
    control.context.push = (push) => pushes.push(push);
    const contextRefs = [
      { kind: 'selection' as const, snapshotText: 'quoted mapping', label: 'quoted' },
    ];

    try {
      const created = await store.createQueuedTurn({
        queuedTurnId: 'queued-ref-1',
        sessionId: session.id,
        userMessageId: 'user-queued-ref-1',
        mode: 'next',
        input: { text: 'Adjust the model mapping', contextRefs },
        fingerprint: 'fingerprint-queued-ref-1',
        submittedAt: new Date().toISOString(),
      });
      expect(created).toMatchObject({ outcome: 'created' });

      const response = await handleSessionLiveCommand(
        {
          type: 'run/intervention-submit',
          sessionId: session.id,
          runId: control.activeRun.runId,
          interventionId: 'intervention-ref-1',
          userMessageId: 'user-queued-ref-1',
          input: { text: 'Adjust the model mapping', contextRefs },
          adoptQueuedTurn: { queuedTurnId: 'queued-ref-1', expectedRevision: 1 },
        },
        undefined,
        control.context,
      );

      expect(response).toMatchObject({
        success: true,
        command: 'run/intervention-submit',
        data: {
          intervention: { interventionId: 'intervention-ref-1', status: 'pending' },
          queuedTurn: { queuedTurnId: 'queued-ref-1', status: 'cancelled' },
        },
      });
      expect(armRunIntervention).toHaveBeenCalledOnce();
      const armed = armRunIntervention.mock.calls[0]?.[0];
      expect(armed?.text).toContain('quoted mapping');
      expect(armed?.text).toContain('Adjust the model mapping');
      expect(pushes.map((push) => push.type)).toContain('session/queued-turn-updated');
      expect(await store.getMessage('user-queued-ref-1')).toMatchObject({
        contextRefs,
        instructionDelivery: { kind: 'run-intervention', instructionId: 'intervention-ref-1' },
      });
    } finally {
      store.close();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects adoption when the submitted payload dropped the frozen context refs', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-intervention-refs-mismatch-'));
    const baseSession = createDelayedSessionHandle();
    const armRunIntervention = vi.fn(async () => undefined);
    const session: SessionHandle = { ...baseSession, armRunIntervention };
    const control = createControlContext(session);
    control.registry.attachRuntimeGeneration(control.activeRun.runId, 'generation-1');
    const store = await openSessionTranscriptStore({
      dbPath: join(rootDir, 'transcript.sqlite3'),
      sessionId: session.id,
      projectPath: '/tmp/project',
    });
    control.context.getTranscriptStore = async () => store;

    try {
      await store.createQueuedTurn({
        queuedTurnId: 'queued-ref-2',
        sessionId: session.id,
        userMessageId: 'user-queued-ref-2',
        mode: 'next',
        input: {
          text: 'Adjust the model mapping',
          contextRefs: [{ kind: 'selection', snapshotText: 'quoted', label: 'quoted' }],
        },
        fingerprint: 'fingerprint-queued-ref-2',
        submittedAt: new Date().toISOString(),
      });
      const response = await handleSessionLiveCommand(
        {
          type: 'run/intervention-submit',
          sessionId: session.id,
          runId: control.activeRun.runId,
          interventionId: 'intervention-ref-2',
          userMessageId: 'user-queued-ref-2',
          input: { text: 'Adjust the model mapping' },
          adoptQueuedTurn: { queuedTurnId: 'queued-ref-2', expectedRevision: 1 },
        },
        undefined,
        control.context,
      );
      expect(response).toMatchObject({
        success: false,
        error: expect.stringContaining('intervention-adopt-payload-mismatch'),
      });
      expect(armRunIntervention).not.toHaveBeenCalled();
      expect(await store.getQueuedTurn('queued-ref-2')).toMatchObject({ status: 'pending' });
    } finally {
      store.close();
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
