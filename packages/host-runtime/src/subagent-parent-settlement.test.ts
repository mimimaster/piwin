import { describe, expect, it } from 'vitest';
import type {
  ContextSummaryPush,
  SessionHandle,
  SubagentBatchResult,
  SubagentTaskResult,
} from '@piwin/contracts';
import {
  boundSubagentControlRunDisplay,
  completedAgentPromptOutcome,
  createUnknownAgentFailure,
} from '@piwin/contracts';
import { formatWaitToolResult } from './host-runtime-subagent-start.js';
import { RunRegistry } from './run-registry.js';
import { terminateHostRun } from './run-terminalizer.js';
import {
  settleParentSubagents,
  type ParentSubagentSettlementPorts,
} from './subagent-parent-settlement.js';

const SESSION_ID = 'parent-session';
const LONG_SUMMARY = `${'uncollected child report '.repeat(40)}end`;

function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(error: Error): void;
} {
  let resolvePromise: ((value: T | PromiseLike<T>) => void) | undefined;
  let rejectPromise: ((error: Error) => void) | undefined;
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return {
    promise,
    resolve: (value: T | PromiseLike<T>) => {
      if (!resolvePromise) throw new Error('deferred promise was not initialized');
      resolvePromise(value);
    },
    reject: (error: Error) => {
      if (!rejectPromise) throw new Error('deferred promise was not initialized');
      rejectPromise(error);
    },
  };
}

function makeBatchResult(
  runId: string,
  overrides: Partial<SubagentTaskResult> = {},
): SubagentBatchResult {
  return {
    runId,
    status: 'completed',
    results: [
      {
        runId,
        taskId: `task-${runId}`,
        childSessionId: `child-${runId}`,
        executionStatus: 'completed',
        summaryStatus: 'pending',
        integrationStatus: 'not-requested',
        summaryPreview: 'child report',
        ...overrides,
      },
    ],
  };
}

function makeLiveSession(promptImpl: SessionHandle['prompt']): Pick<SessionHandle, 'prompt'> {
  return { prompt: promptImpl };
}

function snapshotBatchRunIds(registry: RunRegistry, parentRunId: string): string[] {
  return registry
    .snapshotDirectChildren(parentRunId)
    .filter((child) => child.kind === 'subagent-batch')
    .map((child) => child.runId);
}

function makePorts(
  registry: RunRegistry,
  options: {
    joinBatch: (runId: string) => Promise<SubagentBatchResult>;
    inspectMerge: ParentSubagentSettlementPorts['inspectMerge'];
    cancelBatchesForParentRun?: (parentRunId: string) => void;
    persistAssembly?: (summary: ContextSummaryPush) => Promise<void>;
    lookupBatchOwner?: ParentSubagentSettlementPorts['lookupBatchOwner'];
  },
): ParentSubagentSettlementPorts {
  return {
    closeAdmission: (runId) => registry.closeAdmission(runId),
    snapshotDirectChildren: (runId) => registry.snapshotDirectChildren(runId),
    updatePhase: (runId, phase, detail) => {
      registry.updatePhase(runId, phase, detail);
    },
    getRunSignal: (runId) => registry.getSignal(runId),
    joinBatch: options.joinBatch,
    cancelBatchesForParentRun:
      options.cancelBatchesForParentRun ??
      ((_parentRunId) => {
        throw new Error('cancelBatchesForParentRun should not run on the success path');
      }),
    inspectMerge: options.inspectMerge,
    persistAssembly: options.persistAssembly ?? (async () => undefined),
    nextRequestOrdinal: async () => 2,
    ...(options.lookupBatchOwner ? { lookupBatchOwner: options.lookupBatchOwner } : {}),
  };
}

describe('settleParentSubagents', () => {
  it('skips continuation when every child summary was already merged by wait', async () => {
    const registry = new RunRegistry();
    const parent = registry.createForegroundRun(SESSION_ID);
    const child = registry.create({
      kind: 'subagent-batch',
      sessionId: SESSION_ID,
      parentRunId: parent.runId,
    });
    const firstOutcome = completedAgentPromptOutcome('stop');
    let promptCalls = 0;
    const assemblies: ContextSummaryPush[] = [];

    const settled = await settleParentSubagents({
      sessionId: SESSION_ID,
      parentRunId: parent.runId,
      firstOutcome,
      liveSession: makeLiveSession(async () => {
        promptCalls += 1;
        return completedAgentPromptOutcome('stop');
      }),
      ports: makePorts(registry, {
        joinBatch: async (runId) => makeBatchResult(runId, { summaryStatus: 'merged' }),
        inspectMerge: async () => ({ alreadyMerged: true, summaryPreview: 'already in parent' }),
        persistAssembly: async (summary) => {
          assemblies.push(summary);
        },
      }),
    });

    expect(settled).toEqual({ status: 'completed', outcome: firstOutcome });
    expect(promptCalls).toBe(0);
    expect(assemblies).toEqual([]);
    expect(registry.isAdmissionClosed(parent.runId)).toBe(true);
    expect(registry.get(parent.runId)?.phase).toBe('waiting-subagents');
    expect(snapshotBatchRunIds(registry, parent.runId)).toEqual([child.runId]);
  });

  it('joins a missed wait and issues exactly one bounded continuation', async () => {
    const registry = new RunRegistry();
    const parent = registry.createForegroundRun(SESSION_ID);
    const child = registry.create({
      kind: 'subagent-batch',
      sessionId: SESSION_ID,
      parentRunId: parent.runId,
    });
    const joinHold = createDeferred<SubagentBatchResult>();
    const prompts: string[] = [];
    const assemblies: ContextSummaryPush[] = [];
    const firstOutcome = completedAgentPromptOutcome('toolUse');
    const continuation = completedAgentPromptOutcome('stop');
    const boundedPreview = boundSubagentControlRunDisplay({
      runId: child.runId,
      executionStatus: 'completed',
      summaryPreview: LONG_SUMMARY,
    }).summaryPreview;
    const expected = formatWaitToolResult({
      runs: [
        {
          runId: child.runId,
          invocationId: 'inv-1',
          childSessionId: `child-${child.runId}`,
          ...(boundedPreview ? { summaryPreview: boundedPreview } : {}),
          batchStatus: 'completed',
          executionStatus: 'completed',
          integrationStatus: 'not-requested',
          summaryStatus: 'pending',
        },
      ],
    });

    const settlePromise = settleParentSubagents({
      sessionId: SESSION_ID,
      parentRunId: parent.runId,
      firstOutcome,
      liveSession: makeLiveSession(async (input) => {
        prompts.push(input.text);
        return continuation;
      }),
      ports: makePorts(registry, {
        joinBatch: async () => joinHold.promise,
        inspectMerge: async () => ({ alreadyMerged: false, summaryPreview: LONG_SUMMARY }),
        persistAssembly: async (summary) => {
          assemblies.push(summary);
        },
        lookupBatchOwner: async () => ({ invocationIds: ['inv-1'] }),
      }),
    });

    expect(prompts).toEqual([]);
    joinHold.resolve(makeBatchResult(child.runId, { summaryPreview: LONG_SUMMARY }));
    const settled = await settlePromise;

    expect(settled).toEqual({ status: 'completed', outcome: continuation });
    expect(registry.get(parent.runId)?.phase).toBe('waiting-subagents');
    expect(registry.get(parent.runId)?.phaseDetail).toBe('synthesizing-reports');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('Child admission is closed');
    expect(prompts[0]).toContain(expected.output);
    expect(prompts[0]?.includes(LONG_SUMMARY)).toBe(false);
    expect(boundedPreview !== undefined && prompts[0]?.includes(boundedPreview)).toBe(true);
    expect(assemblies).toHaveLength(1);
    expect(assemblies[0]).toMatchObject({
      requestClass: 'follow-up',
      contributions: [
        expect.objectContaining({
          kind: 'orchestration',
          label: 'Settlement continuation',
          trustOrigin: 'piwin',
        }),
      ],
    });
  });

  it('joins an accepted repair child and does not invent another repair', async () => {
    const registry = new RunRegistry();
    const parent = registry.createForegroundRun(SESSION_ID);
    const repair = registry.create({
      kind: 'subagent-batch',
      sessionId: SESSION_ID,
      parentRunId: parent.runId,
    });
    const prompts: string[] = [];
    const firstOutcome = completedAgentPromptOutcome('toolUse');
    const continuation = completedAgentPromptOutcome('stop');

    const settled = await settleParentSubagents({
      sessionId: SESSION_ID,
      parentRunId: parent.runId,
      firstOutcome,
      liveSession: makeLiveSession(async (input) => {
        prompts.push(input.text);
        return continuation;
      }),
      ports: makePorts(registry, {
        joinBatch: async (runId) =>
          makeBatchResult(runId, {
            childSessionId: 'child-repair',
            predecessorResult: { resultId: 'result-v1', revision: 1 },
            candidateGeneration: 2,
            summaryPreview: 'repaired login guard',
          }),
        inspectMerge: async () => ({ alreadyMerged: false, summaryPreview: 'repaired login guard' }),
      }),
    });

    expect(settled).toEqual({ status: 'completed', outcome: continuation });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('Do not start another subagent');
    expect(prompts[0]).toContain('repaired login guard');
    expect(registry.getChildren(parent.runId)).toEqual([repair.runId]);
  });

  it('rejects a new subagent start during the one-shot continuation', async () => {
    const registry = new RunRegistry();
    const parent = registry.createForegroundRun(SESSION_ID);
    const child = registry.create({
      kind: 'subagent-batch',
      sessionId: SESSION_ID,
      parentRunId: parent.runId,
    });
    let sawClosedAdmission = false;

    const settled = await settleParentSubagents({
      sessionId: SESSION_ID,
      parentRunId: parent.runId,
      firstOutcome: completedAgentPromptOutcome('stop'),
      liveSession: makeLiveSession(async () => {
        sawClosedAdmission = registry.isAdmissionClosed(parent.runId);
        expect(() =>
          registry.create({
            kind: 'subagent-batch',
            sessionId: SESSION_ID,
            parentRunId: parent.runId,
          }),
        ).toThrow(`parent run has closed admission: ${parent.runId}`);
        return completedAgentPromptOutcome('stop');
      }),
      ports: makePorts(registry, {
        joinBatch: async (runId) => makeBatchResult(runId),
        inspectMerge: async () => ({ alreadyMerged: false, summaryPreview: 'late report' }),
      }),
    });

    expect(settled.status).toBe('completed');
    expect(sawClosedAdmission).toBe(true);
    expect(registry.getChildren(parent.runId)).toEqual([child.runId]);
  });

  it('cancels descendants and skips continuation when the parent aborts while joining', async () => {
    const registry = new RunRegistry();
    const parent = registry.createForegroundRun(SESSION_ID);
    const child = registry.create({
      kind: 'subagent-batch',
      sessionId: SESSION_ID,
      parentRunId: parent.runId,
    });
    const joinHold = createDeferred<SubagentBatchResult>();
    const cancelled = createDeferred<void>();
    let promptCalls = 0;
    let cancelCalls = 0;

    const settlePromise = settleParentSubagents({
      sessionId: SESSION_ID,
      parentRunId: parent.runId,
      firstOutcome: completedAgentPromptOutcome('stop'),
      liveSession: makeLiveSession(async () => {
        promptCalls += 1;
        return completedAgentPromptOutcome('stop');
      }),
      ports: makePorts(registry, {
        joinBatch: async () => joinHold.promise,
        inspectMerge: async () => ({ alreadyMerged: false }),
        cancelBatchesForParentRun: () => {
          cancelCalls += 1;
          cancelled.resolve();
        },
      }),
    });

    registry.requestCancel(parent.runId);
    await cancelled.promise;
    joinHold.resolve(makeBatchResult(child.runId, { executionStatus: 'cancelled' }));
    const settled = await settlePromise;

    expect(settled).toEqual({ status: 'aborted' });
    expect(cancelCalls).toBe(1);
    expect(promptCalls).toBe(0);
  });

  it('treats continuation prompt throw as aborted when the parent signal is aborted', async () => {
    const registry = new RunRegistry();
    const parent = registry.createForegroundRun(SESSION_ID);
    const child = registry.create({
      kind: 'subagent-batch',
      sessionId: SESSION_ID,
      parentRunId: parent.runId,
    });
    const promptEntered = createDeferred<void>();
    let promptCalls = 0;
    let cancelCalls = 0;
    let joinCalls = 0;

    const settlePromise = settleParentSubagents({
      sessionId: SESSION_ID,
      parentRunId: parent.runId,
      firstOutcome: completedAgentPromptOutcome('stop'),
      liveSession: makeLiveSession(async () => {
        promptCalls += 1;
        promptEntered.resolve();
        throw new Error('continuation exploded after abort');
      }),
      ports: makePorts(registry, {
        joinBatch: async (runId) => {
          joinCalls += 1;
          return makeBatchResult(runId);
        },
        inspectMerge: async () => ({ alreadyMerged: false, summaryPreview: 'late report' }),
        cancelBatchesForParentRun: () => {
          cancelCalls += 1;
        },
      }),
    });

    await promptEntered.promise;
    registry.requestCancel(parent.runId);
    const settled = await settlePromise;

    expect(settled).toEqual({ status: 'aborted' });
    expect(promptCalls).toBe(1);
    expect(cancelCalls).toBe(1);
    expect(joinCalls).toBe(2);
    expect(snapshotBatchRunIds(registry, parent.runId)).toEqual([child.runId]);
  });

  it('retains child evidence and reports a single failed continuation', async () => {
    const registry = new RunRegistry();
    const parent = registry.createForegroundRun(SESSION_ID);
    const child = registry.create({
      kind: 'subagent-batch',
      sessionId: SESSION_ID,
      parentRunId: parent.runId,
    });
    const retainedResult: SubagentTaskResult = {
      runId: child.runId,
      taskId: `task-${child.runId}`,
      childSessionId: `child-${child.runId}`,
      executionStatus: 'completed',
      summaryStatus: 'pending',
      integrationStatus: 'not-requested',
      summaryPreview: 'keep this report',
    };
    const retained = new Map<string, SubagentTaskResult>([
      [`child-${child.runId}`, retainedResult],
    ]);
    let promptCalls = 0;
    let cancelCalls = 0;

    const settled = await settleParentSubagents({
      sessionId: SESSION_ID,
      parentRunId: parent.runId,
      firstOutcome: completedAgentPromptOutcome('stop'),
      liveSession: makeLiveSession(async () => {
        promptCalls += 1;
        throw new Error('continuation exploded');
      }),
      ports: makePorts(registry, {
        joinBatch: async () => ({
          runId: child.runId,
          status: 'completed',
          results: [retainedResult],
        }),
        inspectMerge: async (childSessionId) => {
          const summaryPreview = retained.get(childSessionId)?.summaryPreview;
          return {
            alreadyMerged: false,
            ...(summaryPreview ? { summaryPreview } : {}),
          };
        },
        cancelBatchesForParentRun: () => {
          cancelCalls += 1;
        },
      }),
    });

    expect(promptCalls).toBe(1);
    expect(cancelCalls).toBe(0);
    expect(retained.get(`child-${child.runId}`)?.summaryPreview).toBe('keep this report');
    expect(settled.status).toBe('failed');
    if (settled.status === 'failed') {
      expect(settled.failure).toEqual(createUnknownAgentFailure('continuation exploded'));
    }
  });
});

describe('non-success parent descendant barrier', () => {
  it('cancels and joins descendants before transcript artifacts and terminal push', async () => {
    const order: string[] = [];
    const joinHold = createDeferred<SubagentBatchResult>();
    const registry = new RunRegistry();
    const parent = registry.createForegroundRun(SESSION_ID);
    const child = registry.create({
      kind: 'subagent-batch',
      sessionId: SESSION_ID,
      parentRunId: parent.runId,
    });
    registry.start(child.runId);

    const originalTerminate = registry.terminate.bind(registry);
    registry.terminate = ((...args: Parameters<RunRegistry['terminate']>) => {
      const terminal = originalTerminate(...args);
      if (terminal?.runId === parent.runId) {
        order.push('terminate');
      }
      return terminal;
    }) as RunRegistry['terminate'];

    const terminatePromise = terminateHostRun(
      {
        runRegistry: registry,
        jobController: {
          stopByRun: async () => {
            order.push('jobs');
            return {
              requestedJobIds: [],
              stoppedJobIds: [],
              alreadyTerminalJobIds: [],
              failedJobIds: [],
            };
          },
        },
        push: () => undefined,
        transcriptRecorders: new Map(),
        withTranscriptStore: async () => {
          order.push('transcript');
          throw new Error('test does not need real transcript artifacts');
        },
        runtimeController: { getStatus: () => ({}) },
        residencyController: { markIdle: () => undefined },
        heartbeatRuntimeLease: async () => undefined,
        runOrchestrationSchemes: new Map(),
        schemeAdmissionGate: { clear: () => undefined },
        runDelegationModes: new Map(),
        runEventCorrelator: { markRunTerminal: () => undefined },
        maybeTriggerAutoName: async () => undefined,
        subagentOrchestrator: {
          cancelBatchesForParentRun: () => {
            order.push('cancel');
          },
          joinBatch: async () => {
            order.push('join-wait');
            const result = await joinHold.promise;
            registry.terminate(child.runId, 'cancelled', 'cancelled');
            order.push('joined');
            return result;
          },
        },
      } as never,
      SESSION_ID,
      parent.runId,
      'failed',
      'failed',
      'parent failed',
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['jobs', 'cancel', 'join-wait']);
    joinHold.resolve(makeBatchResult(child.runId, { executionStatus: 'cancelled' }));
    await expect(terminatePromise).resolves.toBe(true);
    expect(order).toEqual(['jobs', 'cancel', 'join-wait', 'joined', 'transcript', 'terminate']);
    expect(registry.get(parent.runId)?.status).toBe('failed');
  });
});
