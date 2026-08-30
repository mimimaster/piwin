import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent, ContextMeasurement, HostPush } from '@piwin/contracts';
import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import { RunEventCorrelator } from './run-event-correlator.js';
import { RunRegistry } from './run-registry.js';
import { routeSessionAgentEvent } from './session-agent-event-router.js';

function createRouterKernel(input: {
  sessionId: string;
  registry: RunRegistry;
  correlator?: RunEventCorrelator;
  executionRunId?: string;
  generationId?: string;
}): {
  deps: HostRuntimeKernel;
  pushes: HostPush[];
  petEvents: AgentEvent[];
  ledgerWrites: unknown[];
  hookEvents: AgentEvent[];
  measurements: ContextMeasurement[];
  finalized: unknown[];
} {
  const pushes: HostPush[] = [];
  const petEvents: AgentEvent[] = [];
  const ledgerWrites: unknown[] = [];
  const hookEvents: AgentEvent[] = [];
  const measurements: ContextMeasurement[] = [];
  const finalized: unknown[] = [];
  const correlator = input.correlator ?? new RunEventCorrelator();
  const deps = {
    runtimeController: {
      getStatus: () => ({ generationId: input.generationId ?? 'gen-1' }),
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
      reduce: async (event: AgentEvent) => {
        petEvents.push(event);
      },
    }),
    sessionUsage: new Map(),
    enqueueUsageLedgerWrite: (_sessionId: string, usage: unknown) => {
      ledgerWrites.push(usage);
    },
    assistantTextBuffers: new Map(),
    sessionLastAssistantReply: new Map(),
    dispatchHooksForAgentEvent: async (_sessionId: string, event: AgentEvent) => {
      hookEvents.push(event);
    },
    sessionContextCoordinator: {
      ingestMeasurement: async ({ measurement }: { measurement: ContextMeasurement }) => {
        measurements.push(measurement);
      },
      ingestFinalized: async ({ measurement }: { measurement: unknown }) => {
        finalized.push(measurement);
      },
      noteResponseEvidence: async () => undefined,
      noteCompactionStart: async () => undefined,
      noteCompactionEnd: async () => undefined,
    },
  } as unknown as HostRuntimeKernel;
  return { deps, pushes, petEvents, ledgerWrites, hookEvents, measurements, finalized };
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

  it('routes context/measurement to the coordinator without pet, hooks, or billing', () => {
    const registry = new RunRegistry();
    registry.createForegroundRun('session-1');
    const { deps, pushes, petEvents, ledgerWrites, hookEvents, measurements } = createRouterKernel({
      sessionId: 'session-1',
      registry,
    });
    const measurement: ContextMeasurement = {
      sessionId: 'session-1',
      runtimeGenerationId: 'gen-1',
      sampleSequence: 1,
      occupancy: {
        kind: 'known',
        tokensUsed: 90,
        quality: 'measured',
        coverage: 'complete',
        basis: 'test',
        sampledAt: '2026-08-30T00:00:00.000Z',
      },
      contextBoundary: { activeLeafMessageId: 'msg-1' },
      sampledAt: '2026-08-30T00:00:00.000Z',
    };

    routeSessionAgentEvent(
      deps,
      { id: 'session-1' },
      { type: 'context/measurement', measurement },
      'gen-1',
      undefined,
      undefined,
    );

    expect(measurements).toEqual([measurement]);
    expect(petEvents).toEqual([]);
    expect(hookEvents).toEqual([]);
    expect(ledgerWrites).toEqual([]);
    expect(pushes.some((push) => push.type === 'event')).toBe(false);
  });

  it('drops a late sample from a previous runtimeGenerationId before the coordinator', () => {
    const registry = new RunRegistry();
    const { deps, measurements, pushes } = createRouterKernel({
      sessionId: 'session-1',
      registry,
      generationId: 'gen-2',
    });

    routeSessionAgentEvent(
      deps,
      { id: 'session-1' },
      {
        type: 'context/measurement',
        measurement: {
          sessionId: 'session-1',
          runtimeGenerationId: 'gen-1',
          sampleSequence: 4,
          occupancy: { kind: 'unknown', reason: 'stale' },
          contextBoundary: { activeLeafMessageId: null },
          sampledAt: '2026-08-30T00:00:00.000Z',
        },
      },
      'gen-1',
      undefined,
      undefined,
    );

    expect(measurements).toEqual([]);
    expect(pushes.some((push) => push.type === 'event')).toBe(false);
  });

  it('routes usage/finalized to the coordinator and does not bill via usage/update', () => {
    const registry = new RunRegistry();
    registry.createForegroundRun('session-1');
    const { deps, ledgerWrites, hookEvents, petEvents, finalized, pushes } = createRouterKernel({
      sessionId: 'session-1',
      registry,
    });

    routeSessionAgentEvent(
      deps,
      { id: 'session-1' },
      {
        type: 'usage/finalized',
        measurement: {
          measurementId: 'session-1:gen-1:msg-1',
          sessionId: 'session-1',
          runtimeGenerationId: 'gen-1',
          messageId: 'msg-1',
          totalTokens: 12,
          recordedAt: '2026-08-30T00:00:01.000Z',
        },
      },
      'gen-1',
      undefined,
      undefined,
    );

    expect(finalized).toHaveLength(1);
    expect(ledgerWrites).toEqual([]);
    expect(hookEvents).toEqual([]);
    expect(petEvents).toEqual([]);
    expect(pushes.some((push) => push.type === 'event')).toBe(false);
  });

  it('does not bill streaming usage/update', () => {
    const registry = new RunRegistry();
    registry.createForegroundRun('session-1');
    const { deps, ledgerWrites, hookEvents } = createRouterKernel({
      sessionId: 'session-1',
      registry,
    });

    routeSessionAgentEvent(
      deps,
      { id: 'session-1' },
      {
        type: 'usage/update',
        sessionId: 'session-1',
        usage: {
          sessionId: 'session-1',
          totalTokens: 12,
          updatedAt: '2026-08-30T00:00:01.000Z',
          source: 'assistant-usage',
        },
      },
      'gen-1',
      undefined,
      undefined,
    );

    expect(ledgerWrites).toEqual([]);
  });
});
