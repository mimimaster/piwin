/**
 * CE-SUB-LIFE: single-child subagent lifecycle service.
 *
 * Owns validate-parent, resolve snapshot, allocate workspace, create child,
 * seed task, cancel, complete, summary-merge, and integration-state
 * transitions. Command handlers, Plan, UI, and the model tool call this
 * service instead of implementing transitions themselves.
 *
 * This module is the single owner of the three orthogonal state axes:
 *   execution: queued → running → completed | failed | cancelled
 *   summary:   not-requested → pending → merged | failed
 *   integration: not-requested → pending → applied | conflict | failed | retained
 */

import {
  createDefaultSubagentLifecycleState,
  formatSubagentReportContractBlock,
  type PiwinConfig,
  type SubagentApplyPolicy,
  type SubagentIsolationMode,
  type SubagentLifecycleState,
  type SubagentProfileSelector,
  type SubagentRuntimeSnapshot,
  type SubagentSpawnOptions,
  type SubagentTaskSpec,
  type ThinkingLevel,
  type ModelRef,
} from '@piwin/contracts';
import {
  buildSubagentRuntimeSnapshot,
  resolveSubagentProfile,
} from './subagent-profile-resolver.js';

export type SubagentSpawnRequest = {
  parentSessionId: string;
  task: string;
  sessionName?: string;
  /** Caller-side profile selection (profileId + optional model/thinking overrides). */
  selector: SubagentProfileSelector;
  /** Legacy isolation/apply fields; used to make the resolved profile stricter. */
  mode?: SubagentIsolationMode;
  applyPolicy?: SubagentApplyPolicy;
  allowedOutputPaths?: string[];
  retainWorktree?: boolean;
  role?: string;
};

export type SubagentSpawnPlan = {
  snapshot: SubagentRuntimeSnapshot;
  spawnOptions: SubagentSpawnOptions;
  createInput: {
    model?: ModelRef;
    thinkingLevel?: ThinkingLevel;
    subagent: SubagentSpawnOptions;
  };
  lifecycle: SubagentLifecycleState;
  issues: string[];
};

/**
 * Validate parent eligibility and resolve the runtime snapshot + spawn options
 * before any workspace allocation or child creation. Returns a plan that the
 * caller executes; this function performs no I/O.
 */
export function planSubagentSpawn(input: {
  config: PiwinConfig;
  request: SubagentSpawnRequest;
  parentDepth: number;
  parentKind?: string | undefined;
  workingDirectory: string;
  enabledSkillIds: readonly string[];
}): SubagentSpawnPlan | { error: string } {
  const { config, request, parentDepth, parentKind, workingDirectory, enabledSkillIds } = input;

  if (parentKind === 'subagent' || parentDepth >= 1) {
    return { error: 'sub-agent depth max is 1 (cannot nest sub-agents)' };
  }
  const task = request.task.trim();
  if (!task) {
    return { error: 'task is required' };
  }

  const { profile, issues: profileIssues } = resolveSubagentProfile(config, request.selector);
  // Model ref validation issues are fatal — do not create a child with a bad model.
  const fatalIssues = profileIssues.filter(
    (issue) =>
      issue.message.includes('unknown profile') ||
      issue.message.includes('unknown provider') ||
      issue.message.includes('unknown model'),
  );
  const firstFatalIssue = fatalIssues[0];
  if (firstFatalIssue) {
    return { error: firstFatalIssue.message };
  }

  const snapshot = buildSubagentRuntimeSnapshot({
    profile,
    selector: request.selector,
    workingDirectory,
    ...(request.mode ? { callerMode: request.mode } : {}),
    enabledSkillIds,
  });

  const applyPolicy: SubagentApplyPolicy =
    request.applyPolicy === 'auto' || request.applyPolicy === 'explicit'
      ? request.applyPolicy
      : 'none';
  const retainWorktree = request.retainWorktree === true;

  const spawnOptions: SubagentSpawnOptions = {
    mode: snapshot.isolation,
    applyPolicy,
    retainWorktree,
    ...(snapshot.profileId ? { profileId: snapshot.profileId } : {}),
    ...(snapshot.capabilities ? { capabilities: [...snapshot.capabilities] } : {}),
    ...(snapshot.skillIds ? { skillIds: [...snapshot.skillIds] } : {}),
    ...(request.allowedOutputPaths ? { allowedOutputPaths: request.allowedOutputPaths } : {}),
    ...(request.role ? { role: request.role } : {}),
  };

  const createInput: SubagentSpawnPlan['createInput'] = {
    subagent: spawnOptions,
  };
  if (snapshot.model) createInput.model = snapshot.model;
  if (snapshot.thinkingLevel) createInput.thinkingLevel = snapshot.thinkingLevel;

  return {
    snapshot,
    spawnOptions,
    createInput,
    lifecycle: createDefaultSubagentLifecycleState(),
    issues: profileIssues.map((issue) => issue.message),
  };
}

/**
 * Build the seed prompt for a child. The task text is the first user message;
 * profile instructions are not injected as hidden transcript messages.
 * When a scheme member supplies `reportContract`, it is prepended so the
 * parent only needs the child's last assistant message.
 */
export function buildSubagentSeedPrompt(
  task: string,
  snapshot: Pick<SubagentRuntimeSnapshot, 'isolation'>,
  options?: { reportContract?: string },
): string {
  const prefix =
    snapshot.isolation === 'readonly'
      ? '[READONLY sub-agent] Do not modify files or run destructive commands.'
      : '[WORKTREE sub-agent] Work only under the allocated worktree.';
  const contractBlock = formatSubagentReportContractBlock(options?.reportContract);
  if (!contractBlock) return `${prefix}\n\n${task}`;
  return `${prefix}\n\n${contractBlock}\n\n---\n${task}`;
}

/**
 * Model-facing first prompt for a child task. Continuations send the follow-up
 * text as-is (contract was already on the original seed).
 */
export function resolveSubagentChildPrompt(task: Pick<SubagentTaskSpec, 'task' | 'isolationOverride' | 'reportContract' | 'continuationSessionId'>): string {
  if (task.continuationSessionId) return task.task;
  return buildSubagentSeedPrompt(
    task.task,
    { isolation: task.isolationOverride ?? 'readonly' },
    task.reportContract ? { reportContract: task.reportContract } : {},
  );
}

/**
 * Transition the execution state axis. Returns a new state object; never
 * mutates the input.
 */
export function transitionExecutionStatus(
  state: SubagentLifecycleState,
  executionStatus: SubagentLifecycleState['executionStatus'],
): SubagentLifecycleState {
  return { ...state, executionStatus };
}

/**
 * Transition the summary state axis.
 */
export function transitionSummaryStatus(
  state: SubagentLifecycleState,
  summaryStatus: SubagentLifecycleState['summaryStatus'],
): SubagentLifecycleState {
  return { ...state, summaryStatus };
}

/**
 * Transition the integration state axis.
 */
export function transitionIntegrationStatus(
  state: SubagentLifecycleState,
  integrationStatus: SubagentLifecycleState['integrationStatus'],
): SubagentLifecycleState {
  return { ...state, integrationStatus };
}
