import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostPush } from '@piwin/contracts';
import { HostRuntime } from './host-runtime.js';
import { installFixtureAgentAdapter } from './testing/agent-plugin-fixture.js';
import type { BackendUserInputPendingController } from './backend-user-input-pending.js';

let runtime: HostRuntime | undefined;
let directory: string | undefined;
afterEach(async () => {
  await runtime?.dispose();
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
});

const request = {
  title: 'Pick',
  questions: [
    {
      id: 'q1',
      prompt: 'Mode',
      type: 'select' as const,
      choices: [
        { id: 'fast', label: 'Fast' },
        { id: 'careful', label: 'Careful' },
      ],
    },
  ],
};

describe('native user-input generation lifecycle', () => {
  it('cancels only the detached generation pending input and rejects late answers', async () => {
    directory = await mkdtemp(join(tmpdir(), 'piwin-input-gen-'));
    const fixture = await installFixtureAgentAdapter(directory, {
      agentId: 'fixture-input',
      script: {
        backendSessionId: 'native-input-id',
        binaryPath: '/fixture/input',
        capabilities: { agentId: 'fixture-input', operations: {} },
      },
    });
    const pushes: HostPush[] = [];
    runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: directory,
      externalAgents: { env: fixture.env },
    });
    runtime.attachPushSink({
      id: 'input-gen-test',
      push: (message) => pushes.push(message),
    });

    const created = await runtime.handleCommand({
      type: 'session/create',
      input: { agentId: 'fixture-input', projectPath: '/tmp/agent-project' },
    });
    expect(created.success, created.success ? '' : created.error).toBe(true);
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;

    const kernel = runtime as unknown as {
      backendUserInputPending: BackendUserInputPendingController;
      runtimeController: {
        attachGeneration: (sessionId: string, generationId: string, reason: string) => void;
        getStatus: (sessionId: string) => { generationId?: string };
      };
      runRegistry: {
        createForegroundRun: (sessionId: string, generationId?: string) => { runId: string };
      };
      disposeLiveSession: (sessionId: string, reason: string) => Promise<void>;
      sessions: Map<string, { release?: () => Promise<void> }>;
    };

    // Bind a real generation id the same way external activation does, then admit a run.
    const generationId = 'gen-detach-1';
    kernel.runtimeController.attachGeneration(sessionId, generationId, 'external-agent');
    expect(kernel.runtimeController.getStatus(sessionId).generationId).toBe(generationId);
    // A minimal live handle so disposeLiveSession walks the full drop path.
    kernel.sessions.set(sessionId, { release: async () => undefined });
    const run = kernel.runRegistry.createForegroundRun(sessionId, generationId);

    const pending = kernel.backendUserInputPending.requestFromPlugin(
      { request, runId: run.runId },
      { sessionId, runtimeGenerationId: generationId },
    );
    expect(kernel.backendUserInputPending.size).toBe(1);
    const requestPush = pushes.find((entry) => entry.type === 'session/backend-input-request');
    expect(requestPush).toMatchObject({
      type: 'session/backend-input-request',
      sessionId,
      generationId,
      runId: run.runId,
    });
    const requestId = (requestPush as { requestId: string }).requestId;

    // Survivor on another session+generation must not be swept by the detach of gen-detach-1.
    const survivorSessionId = `${sessionId}-survivor`;
    const survivorGenerationId = 'gen-survivor';
    kernel.runtimeController.attachGeneration(survivorSessionId, survivorGenerationId, 'external-agent');
    const survivorRun = kernel.runRegistry.createForegroundRun(survivorSessionId, survivorGenerationId);
    const survivor = kernel.backendUserInputPending.requestFromPlugin(
      { request, runId: survivorRun.runId },
      { sessionId: survivorSessionId, runtimeGenerationId: survivorGenerationId },
    );
    expect(kernel.backendUserInputPending.size).toBe(2);

    // disposeLiveSession captures generation id before detach and cancels only that generation.
    await kernel.disposeLiveSession(sessionId, 'manual');
    await expect(pending).resolves.toEqual({ cancelled: true });
    expect(kernel.backendUserInputPending.size).toBe(1);
    expect(kernel.runtimeController.getStatus(sessionId).generationId).toBeUndefined();
    expect(pushes.some((entry) =>
      entry.type === 'session/backend-input-settled' &&
      (entry as { requestId: string }).requestId === requestId &&
      (entry as { result: { cancelled?: boolean } }).result.cancelled === true,
    )).toBe(true);

    // Late answer for the detached generation never reaches the survivor.
    expect(kernel.backendUserInputPending.respond({
      sessionId,
      requestId,
      generationId,
      runId: run.runId,
      result: { answers: [{ questionId: 'q1', optionIds: ['careful'] }] },
    })).toEqual({ ok: false, error: 'ticket-consumed' });

    // Survivor remains until its own generation is cancelled.
    expect(kernel.backendUserInputPending.size).toBe(1);
    kernel.backendUserInputPending.cancelGeneration(survivorSessionId, survivorGenerationId);
    await expect(survivor).resolves.toEqual({ cancelled: true });
  });
});
