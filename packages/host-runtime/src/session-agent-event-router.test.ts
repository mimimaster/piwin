import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent, HostPush } from '@piwin/contracts';
import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import { RunEventCorrelator } from './run-event-correlator.js';
import { RunRegistry } from './run-registry.js';
import { routeSessionAgentEvent } from './session-agent-event-router.js';

function createRouterKernel(input: {
  sessionId: string;
  registry: RunRegistry;
  correlator?: RunEventCorrelator;
  executionRunId?: string;
}): { deps: HostRuntimeKernel; pushes: HostPush[] } {
  const pushes: HostPush[] = [];
  const correlator = input.correlator ?? new RunEventCorrelator();
  const deps = {
    runtimeController: {
      getStatus: () => ({ generationId: 'gen-1' }),
    },
    runRegistry: input.registry,
    runEventCorrelator: correlator,
    runExecutionContext: {
      getStore: () => input.executionRunId,
    },
    push: (message: HostPush) => {
      pushes.push(message);
    },
    sessionProjects: new Map(),
    sessionModels: new Map(),
    options: {},
    transcriptRecorders: new Map(),
    ensurePetStateStore: async () => ({
      reduce: async () => undefined,
    }),
    sessionUsage: new Map(),
    enqueueUsageLedgerWrite: () => undefined,
    assistantTextBuffers: new Map(),
    sessionLastAssistantReply: new Map(),
    dispatchHooksForAgentEvent: async () => undefined,
  } as unknown as HostRuntimeKernel;
  return { deps, pushes };
}

describe('routeSessionAgentEvent', () => {
  it('drops identity-less errors instead of reclaiming the current Run', () => {
    const registry = new RunRegistry();
    const run = registry.createForegroundRun('session-1');
    const note = vi.spyOn(registry, 'noteAgentEvent');
    const { deps, pushes } = createRouterKernel({
      sessionId: 'session-1',
      registry,
    });

    routeSessionAgentEvent(
      deps,
      { id: 'session-1' },
      { type: 'error', message: '404: No endpoints available' },
      'gen-1',
      undefined,
      undefined,
    );

    expect(note).not.toHaveBeenCalled();
    expect(registry.hasAgentErrorEvidence(run.runId)).toBe(false);
    expect(registry.get(run.runId)).toMatchObject({ status: run.status });
    expect(pushes).toEqual([
      {
        type: 'host/log',
        level: 'warn',
        message: 'discarded uncorrelated session event: error',
      },
    ]);
  });

  it('cannot fail a replacement Run with an old identity-less error', () => {
    const registry = new RunRegistry();
    const first = registry.createForegroundRun('session-1');
    const replacement = registry.replaceForegroundRun('session-1', first.runId);
    const { deps, pushes } = createRouterKernel({
      sessionId: 'session-1',
      registry,
    });

    routeSessionAgentEvent(
      deps,
      { id: 'session-1' },
      { type: 'error', message: 'late identity-less error' } satisfies AgentEvent,
      'gen-1',
      undefined,
      undefined,
    );

    expect(registry.hasAgentErrorEvidence(replacement.runId)).toBe(false);
    expect(registry.get(replacement.runId)?.status).not.toBe('failed');
    expect(pushes.some((message) => message.type === 'event')).toBe(false);
  });
});
