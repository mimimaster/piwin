/**
 * Structured-concurrency settlement for a parent Run that may have started
 * async subagents. Orchestration stays here; call sites only apply the result.
 */
import type {
  AgentFailure,
  AgentPromptOutcome,
  ContextSummaryPush,
  ExecutionRunRecord,
  SessionHandle,
  SessionRunPhase,
  SubagentBatchResult,
} from '@piwin/contracts';
import {
  boundSubagentControlRunDisplay,
  createUnknownAgentFailure,
  formatError,
} from '@piwin/contracts';
import { formatWaitToolResult } from './host-runtime-subagent-start.js';
import { createModelPromptAssembly } from './model-context-assembly.js';
import type { SubagentWaitRunObservation } from './subagent-run-tool.js';

export type ParentSubagentMergeInspection = {
  alreadyMerged?: boolean;
  summaryPreview?: string;
};

export type ParentSubagentSettlementPorts = {
  closeAdmission: (runId: string) => void;
  snapshotDirectChildren: (runId: string) => ExecutionRunRecord[];
  updatePhase: (runId: string, phase: SessionRunPhase, detail?: string) => void;
  getRunSignal: (runId: string) => AbortSignal | undefined;
  joinBatch: (runId: string) => Promise<SubagentBatchResult>;
  cancelBatchesForParentRun: (parentRunId: string) => void;
  lookupBatchOwner?: (runId: string) => Promise<{ invocationIds: string[] } | undefined>;
  inspectMerge: (childSessionId: string) => Promise<ParentSubagentMergeInspection>;
  persistAssembly: (summary: ContextSummaryPush) => Promise<void>;
  nextRequestOrdinal: (sessionId: string) => Promise<number>;
};

export type ParentSubagentSettlementInput = {
  sessionId: string;
  parentRunId: string;
  firstOutcome: AgentPromptOutcome;
  liveSession: Pick<SessionHandle, 'prompt'>;
  ports: ParentSubagentSettlementPorts;
};

export type ParentSubagentSettlementResult =
  | { status: 'completed'; outcome: Extract<AgentPromptOutcome, { status: 'completed' }> }
  | { status: 'aborted' }
  | { status: 'failed'; failure: AgentFailure };

export async function settleParentSubagents(
  input: ParentSubagentSettlementInput,
): Promise<ParentSubagentSettlementResult> {
  const { ports, parentRunId, firstOutcome } = input;
  if (firstOutcome.status !== 'completed') {
    return { status: 'aborted' };
  }
  const completedOutcome = firstOutcome;
  ports.closeAdmission(parentRunId);
  const signal = ports.getRunSignal(parentRunId);
  if (signal?.aborted) {
    await drainDescendants(ports, parentRunId);
    return { status: 'aborted' };
  }

  const batchChildren = snapshotBatchChildren(ports, parentRunId);
  if (batchChildren.length === 0) {
    return { status: 'completed', outcome: completedOutcome };
  }

  ports.updatePhase(parentRunId, 'waiting-subagents', 'joining-descendants');

  let observations: SubagentWaitRunObservation[];
  try {
    observations = await joinAndObserve(ports, batchChildren, signal);
  } catch (error) {
    if (isSettlementAbort(error)) {
      await drainDescendants(ports, parentRunId);
      return { status: 'aborted' };
    }
    throw error;
  }

  if (ports.getRunSignal(parentRunId)?.aborted) {
    await drainDescendants(ports, parentRunId);
    return { status: 'aborted' };
  }

  if (observations.every((observation) => observation.alreadyMerged === true)) {
    return { status: 'completed', outcome: completedOutcome };
  }

  return continueOnceFromUncollected(input, observations);
}

export async function cancelAndJoinParentDescendants(input: {
  parentRunId: string;
  hasActiveDescendants: (runId: string) => boolean;
  cancelBatchesForParentRun: (parentRunId: string) => void;
  snapshotBatchRunIds: (parentRunId: string) => string[];
  joinBatch: (runId: string) => Promise<unknown>;
}): Promise<void> {
  if (!input.hasActiveDescendants(input.parentRunId)) return;
  input.cancelBatchesForParentRun(input.parentRunId);
  for (const runId of input.snapshotBatchRunIds(input.parentRunId)) {
    await input.joinBatch(runId);
  }
}

function snapshotBatchChildren(
  ports: ParentSubagentSettlementPorts,
  parentRunId: string,
): ExecutionRunRecord[] {
  return ports
    .snapshotDirectChildren(parentRunId)
    .filter((child) => child.kind === 'subagent-batch');
}

async function drainDescendants(
  ports: ParentSubagentSettlementPorts,
  parentRunId: string,
): Promise<void> {
  ports.cancelBatchesForParentRun(parentRunId);
  for (const child of snapshotBatchChildren(ports, parentRunId)) {
    await ports.joinBatch(child.runId);
  }
}

async function joinAndObserve(
  ports: ParentSubagentSettlementPorts,
  batchChildren: ExecutionRunRecord[],
  signal: AbortSignal | undefined,
): Promise<SubagentWaitRunObservation[]> {
  const observations: SubagentWaitRunObservation[] = [];
  for (const child of batchChildren) {
    const result = await joinWithAbort(ports.joinBatch(child.runId), signal);
    observations.push(await observeJoinedBatch(ports, child.runId, result));
  }
  return observations;
}

async function observeJoinedBatch(
  ports: ParentSubagentSettlementPorts,
  runId: string,
  result: SubagentBatchResult,
): Promise<SubagentWaitRunObservation> {
  const taskResult = result.results[0];
  const owner = await ports.lookupBatchOwner?.(runId);
  let alreadyMerged = taskResult?.summaryStatus === 'merged';
  let summaryPreview = taskResult?.summaryPreview;
  if (taskResult?.childSessionId) {
    try {
      const inspected = await ports.inspectMerge(taskResult.childSessionId);
      if (inspected.alreadyMerged === true) alreadyMerged = true;
      if (inspected.summaryPreview) summaryPreview = inspected.summaryPreview;
    } catch {
      // Inspection is best-effort; join observation still proceeds.
    }
  }
  return {
    runId,
    ...(owner?.invocationIds[0] ? { invocationId: owner.invocationIds[0] } : {}),
    ...(taskResult?.childSessionId ? { childSessionId: taskResult.childSessionId } : {}),
    ...(summaryPreview ? { summaryPreview } : {}),
    ...(alreadyMerged ? { alreadyMerged: true } : { alreadyMerged: false }),
    batchStatus: result.status,
    executionStatus: taskResult?.executionStatus ?? 'failed',
    integrationStatus: taskResult?.integrationStatus ?? 'not-requested',
    ...(taskResult?.summaryStatus ? { summaryStatus: taskResult.summaryStatus } : {}),
    ...(taskResult?.error ? { error: taskResult.error } : {}),
  };
}

async function continueOnceFromUncollected(
  input: ParentSubagentSettlementInput,
  observations: SubagentWaitRunObservation[],
): Promise<ParentSubagentSettlementResult> {
  const { ports, parentRunId, liveSession, sessionId } = input;
  const uncollected = observations.filter((observation) => observation.alreadyMerged !== true);
  const reports = uncollected.length > 0 ? uncollected : observations;
  const formatted = formatWaitToolResult({
    runs: reports.map(boundWaitObservation),
  });
  const promptText = [
    'Child admission is closed for this run.',
    'The following uncollected subagent reports were recovered after the first model completion.',
    'Revise and synthesize your final answer from these reports. Do not start another subagent.',
    '',
    formatted.output,
  ].join('\n');

  ports.updatePhase(parentRunId, 'waiting-subagents', 'synthesizing-reports');

  const assembly = createModelPromptAssembly();
  assembly.add({
    kind: 'orchestration',
    label: 'Settlement continuation',
    trustOrigin: 'piwin',
    text: promptText,
  });
  const summary = assembly.toSummary({
    sessionId,
    runId: parentRunId,
    requestClass: 'follow-up',
    requestOrdinal: await ports.nextRequestOrdinal(sessionId),
  });
  await ports.persistAssembly(summary);

  if (ports.getRunSignal(parentRunId)?.aborted) {
    await drainDescendants(ports, parentRunId);
    return { status: 'aborted' };
  }

  let continuation: AgentPromptOutcome;
  try {
    continuation = await liveSession.prompt({ text: promptText });
  } catch (error) {
    if (ports.getRunSignal(parentRunId)?.aborted) {
      await drainDescendants(ports, parentRunId);
      return { status: 'aborted' };
    }
    return { status: 'failed', failure: createUnknownAgentFailure(formatError(error)) };
  }

  if (ports.getRunSignal(parentRunId)?.aborted) {
    await drainDescendants(ports, parentRunId);
    return { status: 'aborted' };
  }
  if (continuation.status === 'completed') {
    return { status: 'completed', outcome: continuation };
  }
  if (continuation.status === 'aborted') {
    if (ports.getRunSignal(parentRunId)?.aborted) {
      await drainDescendants(ports, parentRunId);
      return { status: 'aborted' };
    }
    return {
      status: 'failed',
      failure: createUnknownAgentFailure(
        continuation.message ?? 'settlement continuation aborted without a Host abort reason',
      ),
    };
  }
  return { status: 'failed', failure: continuation.failure };
}

function boundWaitObservation(run: SubagentWaitRunObservation): SubagentWaitRunObservation {
  const bounded = boundSubagentControlRunDisplay({
    runId: run.runId,
    executionStatus: run.executionStatus,
    ...(run.invocationId ? { invocationId: run.invocationId } : {}),
    ...(run.childSessionId ? { childSessionId: run.childSessionId } : {}),
    ...(run.summaryPreview ? { summaryPreview: run.summaryPreview } : {}),
    ...(run.summaryStatus ? { summaryStatus: run.summaryStatus } : {}),
    ...(run.integrationStatus ? { integrationStatus: run.integrationStatus } : {}),
  });
  return {
    ...run,
    ...(bounded.summaryPreview ? { summaryPreview: bounded.summaryPreview } : {}),
  };
}

class SettlementAbortedError extends Error {
  constructor() {
    super('aborted while joining parent subagents');
    this.name = 'SettlementAbortedError';
  }
}

function isSettlementAbort(error: unknown): boolean {
  return error instanceof SettlementAbortedError;
}

async function joinWithAbort<T>(join: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return join;
  if (signal.aborted) throw new SettlementAbortedError();
  return await new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      cleanup();
      reject(new SettlementAbortedError());
    };
    const cleanup = (): void => {
      signal.removeEventListener('abort', onAbort);
    };
    signal.addEventListener('abort', onAbort);
    join.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}
