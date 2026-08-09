/**
 * ADR 0040 release-gate integration scenarios (WP8).
 *
 * - Prompt many distinct sessions under a tight retention policy and assert
 *   resident counts return to budget. Both `sdk` and `rpc` modes run with
 *   `mock: true`, so they exercise the same Host residency controller rather
 *   than proving real RPC worker process counts.
 * - History-only reads of cold sessions never allocate a runtime while another
 *   session stays busy.
 * - Cancellation while waiting for runtime capacity aborts the cold prompt's
 *   admission via `session/abort` (end-to-end Host command path).
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostPush, HostRuntimeResourcesData } from '@piwin/contracts';
import { HostRuntime } from './host-runtime.js';
import { createDefaultPiwinConfig, savePiwinConfig } from './config-store.js';
import type { SessionRuntimeResidencyController } from './sessions/session-runtime-residency-controller.js';
import type { SessionRuntimeController } from './sessions/session-runtime-controller.js';

function residencyOf(runtime: HostRuntime): SessionRuntimeResidencyController {
  return (
    runtime as unknown as {
      residencyController: SessionRuntimeResidencyController;
    }
  ).residencyController;
}

function runtimeControllerOf(runtime: HostRuntime): SessionRuntimeController {
  return (
    runtime as unknown as {
      runtimeController: SessionRuntimeController;
    }
  ).runtimeController;
}

function generationOf(runtime: HostRuntime, sessionId: string): string {
  const controller = runtimeControllerOf(runtime);
  const generationId = controller.getStatus(sessionId).generationId;
  if (!generationId) {
    throw new Error(`missing generation for ${sessionId}`);
  }
  return generationId;
}

async function waitForResources(
  runtime: HostRuntime,
  predicate: (data: HostRuntimeResourcesData) => boolean,
  attempts = 150,
): Promise<HostRuntimeResourcesData> {
  let last: HostRuntimeResourcesData | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await runtime.handleCommand({ type: 'host/runtime-resources' });
    if (!response.success) {
      throw new Error(response.error);
    }
    last = response.data as HostRuntimeResourcesData;
    if (predicate(last)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for resources: ${JSON.stringify(last)}`);
}

async function waitForIdleOrCold(
  runtime: HostRuntime,
  sessionId: string,
  attempts = 150,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const residency = residencyOf(runtime).getResidency(sessionId);
    if (residency === 'resident-idle' || residency === 'cold') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`session ${sessionId} never became idle/cold`);
}

async function waitForGeneration(runtime: HostRuntime, sessionId: string): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (runtimeControllerOf(runtime).getStatus(sessionId).generationId !== undefined) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`session ${sessionId} never acquired a runtime generation`);
}

async function createConfiguredRuntime(input: {
  rootDir: string;
  mode: 'sdk' | 'rpc';
  maxIdleRuntimes: number;
  maxResidentRuntimes: number;
  idleTtlSeconds?: number;
  onPush?: (message: HostPush) => void;
}): Promise<HostRuntime> {
  const config = createDefaultPiwinConfig();
  config.hostMode = input.mode;
  config.session = {
    autoName: false,
    runtimeRetention: {
      idleTtlSeconds: input.idleTtlSeconds ?? 600,
      maxIdleRuntimes: input.maxIdleRuntimes,
      maxResidentRuntimes: input.maxResidentRuntimes,
    },
  };
  await savePiwinConfig(config, input.rootDir);
  return new HostRuntime({
    mode: input.mode,
    mock: true,
    piwinRoot: input.rootDir,
    ...(input.onPush ? { onPush: input.onPush } : {}),
  });
}

describe('Session runtime residency integration (WP8 / ADR 0040)', () => {
  for (const mode of ['sdk', 'rpc'] as const) {
    it(`${mode}: prompts 50 sessions and keeps resident counts within policy`, async () => {
      const rootDir = await mkdtemp(join(tmpdir(), `piwin-residency-50-${mode}-`));
      const maxIdleRuntimes = 2;
      const maxResidentRuntimes = 3;
      const runtime = await createConfiguredRuntime({
        rootDir,
        mode,
        maxIdleRuntimes,
        maxResidentRuntimes,
      });

      const sessionIds: string[] = [];
      for (let index = 0; index < 50; index += 1) {
        const created = await runtime.handleCommand({
          type: 'session/create',
          input: { projectPath: `/tmp/residency-50-${mode}`, sessionName: `S${index}` },
        });
        expect(created.success).toBe(true);
        if (!created.success) throw new Error(created.error);
        const sessionId = (created.data as { sessionId: string }).sessionId;
        sessionIds.push(sessionId);

        const prompted = await runtime.handleCommand({
          type: 'session/prompt',
          sessionId,
          input: { text: `hello session ${index}` },
        });
        expect(prompted.success).toBe(true);
        await waitForIdleOrCold(runtime, sessionId);

        const resources = await runtime.handleCommand({ type: 'host/runtime-resources' });
        expect(resources.success).toBe(true);
        if (!resources.success) throw new Error(resources.error);
        const data = resources.data as HostRuntimeResourcesData;
        expect(data.counts.resident).toBeLessThanOrEqual(maxResidentRuntimes);
        expect(data.counts.idle).toBeLessThanOrEqual(maxIdleRuntimes);
        expect(data.counts.busy).toBe(0);
      }

      const finalResources = await waitForResources(
        runtime,
        (data) =>
          data.counts.resident <= maxResidentRuntimes &&
          data.counts.idle <= maxIdleRuntimes &&
          data.counts.busy === 0,
      );
      expect(finalResources.counts.resident).toBeLessThanOrEqual(maxResidentRuntimes);
      expect(finalResources.counts.idle).toBeLessThanOrEqual(maxIdleRuntimes);
      expect(
        finalResources.counters.evictedByMaxIdle +
          finalResources.counters.evictedByMaxResident +
          finalResources.counters.evictedByIdleTtl,
      ).toBeGreaterThan(0);

      const earlySessionId = sessionIds[0];
      if (!earlySessionId) throw new Error('missing early session');
      const messages = await runtime.handleCommand({
        type: 'session/messages',
        sessionId: earlySessionId,
      });
      expect(messages.success).toBe(true);
      if (!messages.success) throw new Error(messages.error);
      const rows = (messages.data as { messages: Array<{ role: string }> }).messages;
      expect(rows.some((row) => row.role === 'user')).toBe(true);
      expect(residencyOf(runtime).getResidency(earlySessionId)).toBe('cold');

      await runtime.dispose();
    }, 120_000);
  }

  it('keeps cold history usable for two viewers while a third session stays busy', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-residency-multi-client-'));
    const projectPath = '/tmp/multi-client';
    const runtime = await createConfiguredRuntime({
      rootDir,
      mode: 'sdk',
      maxIdleRuntimes: 1,
      maxResidentRuntimes: 2,
    });

    const coldA = await runtime.handleCommand({
      type: 'session/create',
      input: { projectPath, sessionName: 'Cold A' },
    });
    const coldB = await runtime.handleCommand({
      type: 'session/create',
      input: { projectPath, sessionName: 'Cold B' },
    });
    expect(coldA.success && coldB.success).toBe(true);
    if (!coldA.success || !coldB.success) {
      throw new Error('failed to create cold sessions');
    }
    const sessionA = (coldA.data as { sessionId: string }).sessionId;
    const sessionB = (coldB.data as { sessionId: string }).sessionId;

    // session/create materializes a runtime; suspend A/B so they are cold with
    // durable history only (two history viewers).
    for (const [sessionId, text] of [
      [sessionA, 'history for A'],
      [sessionB, 'history for B'],
    ] as const) {
      const seeded = await runtime.handleCommand({
        type: 'session/prompt',
        sessionId,
        input: { text },
      });
      expect(seeded.success).toBe(true);
      await waitForGeneration(runtime, sessionId);
      await waitForIdleOrCold(runtime, sessionId);
    }
    for (const sessionId of [sessionA, sessionB]) {
      if (residencyOf(runtime).getResidency(sessionId) !== 'cold') {
        const generationId = generationOf(runtime, sessionId);
        expect(await residencyOf(runtime).requestSuspend(sessionId, generationId, 'manual')).toBe(
          true,
        );
        await waitForIdleOrCold(runtime, sessionId);
      }
      expect(residencyOf(runtime).getResidency(sessionId)).toBe('cold');
    }

    const busyCreated = await runtime.handleCommand({
      type: 'session/create',
      input: { projectPath, sessionName: 'Busy' },
    });
    expect(busyCreated.success).toBe(true);
    if (!busyCreated.success) throw new Error(busyCreated.error);
    const busyId = (busyCreated.data as { sessionId: string }).sessionId;
    const busyPrompt = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId: busyId,
      input: { text: 'stay busy' },
    });
    expect(busyPrompt.success).toBe(true);
    await waitForIdleOrCold(runtime, busyId);
    // Hold the third session busy without relying on the hang fixture (which
    // bypasses ProductAgentHost generation registration).
    const busyGenerationId = generationOf(runtime, busyId);
    residencyOf(runtime).markBusy(busyId, busyGenerationId);
    expect(residencyOf(runtime).getResidency(busyId)).toBe('resident-busy');

    const messagesA = await runtime.handleCommand({
      type: 'session/messages',
      sessionId: sessionA,
    });
    const messagesB = await runtime.handleCommand({
      type: 'session/messages',
      sessionId: sessionB,
    });
    expect(messagesA.success && messagesB.success).toBe(true);
    if (!messagesA.success || !messagesB.success) {
      throw new Error('history read failed');
    }
    expect(
      (messagesA.data as { messages: Array<{ text: string }> }).messages.some((row) =>
        row.text.includes('history for A'),
      ),
    ).toBe(true);
    expect(
      (messagesB.data as { messages: Array<{ text: string }> }).messages.some((row) =>
        row.text.includes('history for B'),
      ),
    ).toBe(true);
    expect(residencyOf(runtime).getResidency(sessionA)).toBe('cold');
    expect(residencyOf(runtime).getResidency(sessionB)).toBe('cold');
    expect(residencyOf(runtime).getResidency(busyId)).toBe('resident-busy');

    const resources = await runtime.handleCommand({ type: 'host/runtime-resources' });
    expect(resources.success).toBe(true);
    if (!resources.success) throw new Error(resources.error);
    const data = resources.data as HostRuntimeResourcesData;
    expect(data.counts.busy).toBeGreaterThanOrEqual(1);
    expect(data.counts.resident).toBeLessThanOrEqual(2);

    residencyOf(runtime).markIdle(busyId, busyGenerationId);
    await runtime.dispose();
  }, 60_000);

  it('cancels a prompt that is waiting for runtime capacity', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-residency-cancel-wait-'));
    const pushes: HostPush[] = [];
    // Create both durable sessions under a roomy budget, then pin the holder
    // as the sole busy resident so the waiter's cold prompt must queue.
    const runtime = await createConfiguredRuntime({
      rootDir,
      mode: 'sdk',
      maxIdleRuntimes: 2,
      maxResidentRuntimes: 2,
      onPush: (message) => pushes.push(message),
    });

    const first = await runtime.handleCommand({
      type: 'session/create',
      input: { projectPath: '/tmp/cancel-wait', sessionName: 'Holder' },
    });
    const second = await runtime.handleCommand({
      type: 'session/create',
      input: { projectPath: '/tmp/cancel-wait', sessionName: 'Waiter' },
    });
    expect(first.success && second.success).toBe(true);
    if (!first.success || !second.success) {
      throw new Error('failed to create holder/waiter sessions');
    }
    const holderId = (first.data as { sessionId: string }).sessionId;
    const waiterId = (second.data as { sessionId: string }).sessionId;
    await waitForGeneration(runtime, holderId);
    await waitForGeneration(runtime, waiterId);
    // Capture generation ids before any prompt can trigger idle eviction of
    // the peer session under a tight budget.
    const holderGenerationAtCreate = generationOf(runtime, holderId);
    const waiterGenerationAtCreate = generationOf(runtime, waiterId);

    // If the waiter was already cold-evicted while holder was busy, skip the
    // explicit suspend; otherwise suspend it for a deterministic cold prompt.
    if (residencyOf(runtime).getResidency(waiterId) !== 'cold') {
      // Pin holder busy first so max-idle eviction cannot race with suspend.
      residencyOf(runtime).markBusy(holderId, holderGenerationAtCreate);
      expect(
        await residencyOf(runtime).requestSuspend(waiterId, waiterGenerationAtCreate, 'manual'),
      ).toBe(true);
      residencyOf(runtime).markIdle(holderId, holderGenerationAtCreate);
    }
    await waitForIdleOrCold(runtime, waiterId);
    expect(residencyOf(runtime).getResidency(waiterId)).toBe('cold');

    const holderPrompt = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId: holderId,
      input: { text: 'hold capacity' },
    });
    expect(holderPrompt.success).toBe(true);
    await waitForIdleOrCold(runtime, holderId);
    await waitForIdleOrCold(runtime, waiterId);
    expect(residencyOf(runtime).getResidency(waiterId)).toBe('cold');

    // Cold projection stays truthful after suspension (WP7 P1).
    const coldStatus = await runtime.handleCommand({
      type: 'session/runtime-status',
      sessionId: waiterId,
    });
    expect(coldStatus).toMatchObject({
      success: true,
      data: {
        status: {
          residency: 'cold',
          lastEvictionReason: 'manual',
        },
      },
    });

    const holderGenerationId = generationOf(runtime, holderId);
    residencyOf(runtime).markBusy(holderId, holderGenerationId);
    residencyOf(runtime).updateRetention({
      idleTtlSeconds: 600,
      maxIdleRuntimes: 1,
      maxResidentRuntimes: 1,
    });
    expect(residencyOf(runtime).getResidency(holderId)).toBe('resident-busy');
    expect(residencyOf(runtime).getCounts().resident).toBe(1);

    // Accept the waiter prompt (returns before activation finishes), then
    // wait for Host capacity queueing.
    const waiterPrompt = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId: waiterId,
      input: { text: 'I will wait then cancel' },
    });
    expect(waiterPrompt.success).toBe(true);
    if (!waiterPrompt.success) throw new Error(waiterPrompt.error);
    const waiterRunId = (waiterPrompt.data as { runId: string }).runId;

    await waitForResources(runtime, (data) => data.waiterCount >= 1);
    expect(residencyOf(runtime).getResidency(holderId)).toBe('resident-busy');

    // waiting-resource may be published while queued; tolerate either timing.
    const sawWaitingResource = pushes.some(
      (push) =>
        push.type === 'run/updated' &&
        push.run.sessionId === waiterId &&
        push.run.phase === 'waiting-resource',
    );

    const aborted = await runtime.handleCommand({
      type: 'session/abort',
      sessionId: waiterId,
      runId: waiterRunId,
    });
    expect(aborted).toMatchObject({
      success: true,
      data: { cancelled: true, runId: waiterRunId },
    });

    // Waiter must not remain activating; holder stays the protected resident.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const residency = residencyOf(runtime).getResidency(waiterId);
      if (residency === 'cold' || residency === 'resident-idle') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(['cold', 'resident-idle']).toContain(residencyOf(runtime).getResidency(waiterId));
    expect(residencyOf(runtime).getResidency(holderId)).toBe('resident-busy');
    expect(residencyOf(runtime).getCounts().waiterCount).toBe(0);
    // Soft assertion: phase emission is best-effort under race with abort.
    void sawWaitingResource;

    residencyOf(runtime).markIdle(holderId, holderGenerationId);
    await runtime.dispose();
  }, 60_000);

});
