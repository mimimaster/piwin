import type {
  HostPush,
  SubagentBatchRequest,
  SubagentBatchResult,
  SubagentInvocation,
  SubagentInvocationActivity,
  SubagentTaskResult,
  SubagentTaskRunner,
  SubagentWorkspaceLease,
} from '@piwin/contracts';
import type { RunRegistry } from './run-registry.js';
import type { RuntimeResourceCoordinator } from './runtime-resource-coordinator.js';
import type { SchedulerState } from './subagent-scheduler.js';
import type { SubagentIntegrationCoordinator } from './subagent-integration-coordinator.js';
import type {
  PreparedSubagentTask,
  SubagentOrchestratorOptions,
  SubagentRunStorePort,
  SubagentTaskPreparationInput,
  SubagentWorkspaceService,
} from './subagent-orchestrator-types.js';

/** Internal state for an active batch. */
export interface BatchState {
  runId: string;
  runtimeGenerationId: string;
  parentRunId?: string;
  request: SubagentBatchRequest;
  schedulerState: SchedulerState;
  results: Map<string, SubagentTaskResult>;
  leases: Map<string, SubagentWorkspaceLease>;
  taskRunIds: Map<string, string>;
  invocations: Map<string, SubagentInvocation>;
  errors: Error[];
  accepted: Promise<void>;
  resolveAccepted: () => void;
  rejectAccepted: (error: Error) => void;
  completion: Promise<SubagentBatchResult>;
  resolveCompletion: (result: SubagentBatchResult) => void;
  rejectCompletion: (error: Error) => void;
}

/** Collaborator bag passed to extracted orchestrator helpers. Not a second scheduler. */
export type SubagentOrchestratorContext = {
  taskRunner: SubagentTaskRunner;
  workspaceService: SubagentWorkspaceService;
  prepareTask: (input: SubagentTaskPreparationInput) => Promise<PreparedSubagentTask>;
  preflightTask: SubagentOrchestratorOptions['preflightTask'];
  integrationCoordinator: SubagentIntegrationCoordinator;
  resourceCoordinator: RuntimeResourceCoordinator | undefined;
  runRegistry: RunRegistry;
  runStore: SubagentRunStorePort | undefined;
  registerTaskSession: SubagentOrchestratorOptions['registerTaskSession'];
  unregisterTaskSession: SubagentOrchestratorOptions['unregisterTaskSession'];
  recordTaskPrompt: SubagentOrchestratorOptions['recordTaskPrompt'];
  onTaskResult: SubagentOrchestratorOptions['onTaskResult'];
  freezeChildResult: SubagentOrchestratorOptions['freezeChildResult'];
  emitPush: (batchState: BatchState, message: HostPush) => void;
  activeBatches: Map<string, BatchState>;
};

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function combineErrors(errors: readonly Error[], message: string): Error {
  const firstError = errors[0];
  if (errors.length === 1 && firstError) return firstError;
  return new AggregateError(errors, message);
}

export function invocationActivityKey(activity: SubagentInvocationActivity): string {
  switch (activity.kind) {
    case 'tool':
      return `${activity.kind}:${activity.toolName}:${activity.title ?? ''}`;
    case 'permission':
      return `${activity.kind}:${activity.action}`;
    case 'completed':
      return `${activity.kind}:${activity.summary ?? ''}`;
    case 'needs-integration':
      return `${activity.kind}:${activity.message ?? ''}`;
    case 'failed':
      return `${activity.kind}:${activity.message ?? ''}`;
    default:
      return activity.kind;
  }
}

export function createCompletionLatch(): {
  completion: Promise<SubagentBatchResult>;
  resolveCompletion: (result: SubagentBatchResult) => void;
  rejectCompletion: (error: Error) => void;
} {
  let resolveCompletion: ((result: SubagentBatchResult) => void) | undefined;
  let rejectCompletion: ((error: Error) => void) | undefined;
  const completion = new Promise<SubagentBatchResult>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });

  if (!resolveCompletion || !rejectCompletion) {
    throw new Error('batch completion latch was not initialized');
  }

  return { completion, resolveCompletion, rejectCompletion };
}

export function createAcceptedLatch(): {
  accepted: Promise<void>;
  resolveAccepted: () => void;
  rejectAccepted: (error: Error) => void;
} {
  let settled = false;
  let resolveAccepted: (() => void) | undefined;
  let rejectAccepted: ((error: Error) => void) | undefined;
  const accepted = new Promise<void>((resolve, reject) => {
    resolveAccepted = resolve;
    rejectAccepted = reject;
  });

  if (!resolveAccepted || !rejectAccepted) {
    throw new Error('batch accepted latch was not initialized');
  }

  return {
    accepted,
    resolveAccepted: () => {
      if (settled) return;
      settled = true;
      resolveAccepted?.();
    },
    rejectAccepted: (error: Error) => {
      if (settled) return;
      settled = true;
      rejectAccepted?.(error);
    },
  };
}
