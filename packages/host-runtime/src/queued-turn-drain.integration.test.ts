import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostRuntime } from './host-runtime.js';

describe('queued-turn drain after a completed run', () => {
  const runtimes: HostRuntime[] = [];

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
  });

  it('starts the queued turn after the foreground run completes naturally', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-queued-drain-'));
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
      testFixture: 'slow-first-token',
    });
    runtimes.push(runtime);

    const created = await runtime.handleCommand({
      type: 'session/create',
      input: { projectPath: '/tmp/project' },
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;

    const first = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'first turn' },
    });
    expect(first.success).toBe(true);
    if (!first.success) throw new Error(first.error);
    const firstRunId = (first.data as { runId: string }).runId;

    const queued = await runtime.handleCommand({
      type: 'session/queued-turn-submit',
      sessionId,
      queuedTurnId: randomUUID(),
      userMessageId: randomUUID(),
      input: { text: 'next turn' },
    });
    expect(queued).toMatchObject({
      success: true,
      data: { queuedTurn: { status: 'pending' } },
    });

    await vi.waitFor(async () => {
      const listed = await runtime.handleCommand({
        type: 'session/queued-turn-list',
        sessionId,
      });
      expect(listed.success).toBe(true);
      if (!listed.success) throw new Error(listed.error);
      const turns = (listed.data as { queuedTurns: Array<{ status: string; startedRunId?: string }> })
        .queuedTurns;
      expect(turns).toHaveLength(1);
      expect(turns[0]?.status).toBe('started');
      expect(turns[0]?.startedRunId).toEqual(expect.any(String));
      expect(turns[0]?.startedRunId).not.toBe(firstRunId);
    });

  }, 15_000);
});
