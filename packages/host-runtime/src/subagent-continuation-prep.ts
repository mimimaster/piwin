import { randomUUID } from 'node:crypto';
import type {
  SessionIndexRecord,
  SubagentIsolationMode,
  SubagentResultRef,
  SubagentReviewRef,
  SubagentTaskSpec,
  SubagentWorkspaceLease,
} from '@piwin/contracts';
import { getSessionRecord } from '@piwin/session';
import { getPiwinGeneralWorkspacePath, getPiwinRoot, getPiwinSessionIndexPath } from './paths.js';

export type PreparedSubagentContinuation = {
  child: SessionIndexRecord;
  parent: SessionIndexRecord;
  runtime: NonNullable<SessionIndexRecord['subagentRuntime']>;
  mode: SubagentIsolationMode;
  continuationWorkspaceLease: SubagentWorkspaceLease;
  /** Set when the child's own frozen state must be checked back out first. */
  continuationRestore?: { baseCommit: string; tree: string };
};

export type SubagentContinuationPrepDeps = {
  options: { piwinRoot?: string };
  resolveRetainedSubagentWorktreeLease: (
    child: SessionIndexRecord,
  ) => Promise<Extract<SubagentWorkspaceLease, { mode: 'worktree' }>>;
  /**
   * Frozen state the continuation must restore. A shared writer slot has been
   * reset since the child last wrote to it, so the child's own state only
   * survives as Git objects; without this the child would resume in a stranger's
   * working directory.
   */
  resolveSubagentContinuationRestore: (
    child: SessionIndexRecord,
  ) => Promise<{ baseCommit: string; tree: string } | undefined>;
};

export type ReviewedContinuationTaskExtras = {
  invocationId?: string;
  parentRunId?: string;
  parentToolCallId?: string;
  task: string;
  candidateLineageId: string;
  candidateGeneration: number;
  predecessorResult: SubagentResultRef;
  reviewRef?: SubagentReviewRef;
};

export async function prepareRetainedSubagentContinuation(
  deps: SubagentContinuationPrepDeps,
  childSessionId: string,
): Promise<PreparedSubagentContinuation> {
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const indexPath = getPiwinSessionIndexPath(rootDir);
  const child = await getSessionRecord(indexPath, childSessionId);
  if (!child || child.kind !== 'subagent' || !child.parentSessionId) {
    throw new Error(`subagent child session not found: ${childSessionId}`);
  }
  if (
    child.subagentStatus === 'running' ||
    child.subagentLifecycle?.executionStatus === 'queued' ||
    child.subagentLifecycle?.executionStatus === 'running'
  ) {
    throw new Error('subagent is still running; wait for it to finish before continuing');
  }
  const runtime = child.subagentRuntime;
  if (!runtime) {
    throw new Error('subagent runtime snapshot is unavailable; open a new delegated task');
  }
  const parent = await getSessionRecord(indexPath, child.parentSessionId);
  if (!parent) {
    throw new Error(`subagent parent session not found: ${child.parentSessionId}`);
  }

  const mode = child.subagentMode ?? runtime.isolation;
  const parentScope =
    parent.scope ??
    (parent.projectPath
      ? ({ kind: 'project', projectPath: parent.projectPath } as const)
      : ({ kind: 'general' } as const));
  const continuationWorkspaceLease =
    mode === 'worktree'
      ? await deps.resolveRetainedSubagentWorktreeLease(child)
      : {
          mode: 'readonly' as const,
          cwd: child.workingDirectory ?? runtime.workingDirectory,
          parentRepoPath:
            parentScope.kind === 'project'
              ? parentScope.projectPath
              : getPiwinGeneralWorkspacePath(rootDir),
        };
  const continuationRestore =
    mode === 'worktree'
      ? await deps.resolveSubagentContinuationRestore(child)
      : undefined;
  return {
    child,
    parent,
    runtime,
    mode,
    continuationWorkspaceLease,
    ...(continuationRestore ? { continuationRestore } : {}),
  };
}

export function buildShellContinuationTask(
  prepared: PreparedSubagentContinuation,
  text: string,
): SubagentTaskSpec {
  return buildContinuationTask(prepared, {
    task: text,
    applyPolicy: 'none',
  });
}

export function buildReviewedContinuationTask(
  prepared: PreparedSubagentContinuation,
  extras: ReviewedContinuationTaskExtras,
): SubagentTaskSpec {
  return buildContinuationTask(prepared, {
    task: extras.task,
    applyPolicy: 'explicit', // reviewed continue never auto-applies
    deliveryIntent: 'candidate',
    ...(extras.invocationId ? { invocationId: extras.invocationId } : {}),
    ...(extras.parentRunId ? { parentRunId: extras.parentRunId } : {}),
    ...(extras.parentToolCallId ? { parentToolCallId: extras.parentToolCallId } : {}),
    candidateLineageId: extras.candidateLineageId,
    candidateGeneration: extras.candidateGeneration,
    predecessorResult: extras.predecessorResult,
    ...(extras.reviewRef ? { reviewRef: extras.reviewRef } : {}),
  });
}

function buildContinuationTask(
  prepared: PreparedSubagentContinuation,
  extras: {
    task: string;
    applyPolicy: NonNullable<SubagentTaskSpec['applyPolicy']>;
    deliveryIntent?: SubagentTaskSpec['deliveryIntent'];
    invocationId?: string;
    parentRunId?: string;
    parentToolCallId?: string;
    candidateLineageId?: string;
    candidateGeneration?: number;
    predecessorResult?: SubagentResultRef;
    reviewRef?: SubagentReviewRef;
  },
): SubagentTaskSpec {
  const { child, runtime, mode, continuationWorkspaceLease } = prepared;
  return {
    id: randomUUID(),
    parentSessionId: child.parentSessionId ?? '',
    task: extras.task,
    continuationSessionId: child.id,
    continuationWorkspaceLease,
    ...(prepared.continuationRestore
      ? { continuationRestore: prepared.continuationRestore }
      : {}),
    sessionName: child.name ?? `subagent-${child.id.slice(0, 8)}`,
    ...(extras.invocationId ? { invocationId: extras.invocationId } : {}),
    ...(extras.parentRunId ? { parentRunId: extras.parentRunId } : {}),
    ...(extras.parentToolCallId ? { parentToolCallId: extras.parentToolCallId } : {}),
    ...(runtime.profileId ? { profileId: runtime.profileId } : {}),
    ...(runtime.model ? { model: runtime.model } : {}),
    ...(runtime.thinkingLevel ? { thinkingLevel: runtime.thinkingLevel } : {}),
    ...(runtime.capabilities ? { capabilities: [...runtime.capabilities] } : {}),
    ...(runtime.skillIds ? { skillIds: [...runtime.skillIds] } : {}),
    isolationOverride: mode,
    applyPolicy: extras.applyPolicy,
    ...(extras.deliveryIntent ? { deliveryIntent: extras.deliveryIntent } : {}),
    ...(child.subagentRole ? { role: child.subagentRole } : {}),
    ...(child.subagentAllowedOutputPaths
      ? { allowedOutputPaths: [...child.subagentAllowedOutputPaths] }
      : {}),
    ...(extras.candidateLineageId ? { candidateLineageId: extras.candidateLineageId } : {}),
    ...(extras.candidateGeneration !== undefined
      ? { candidateGeneration: extras.candidateGeneration }
      : {}),
    ...(extras.predecessorResult ? { predecessorResult: extras.predecessorResult } : {}),
    ...(extras.reviewRef ? { reviewRef: extras.reviewRef } : {}),
  };
}
