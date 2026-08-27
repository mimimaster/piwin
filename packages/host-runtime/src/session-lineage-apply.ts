import { createSessionRecord } from '@piwin/session';
import type { SessionLineage } from './host-runtime-types.js';

export function applySubagentLineage(
  record: import('@piwin/contracts').SessionIndexRecord,
  lineage: SessionLineage | undefined,
): void {
  if (!lineage) {
    return;
  }
  if (lineage.subagentMode) record.subagentMode = lineage.subagentMode;
  if (lineage.subagentApplyPolicy) record.subagentApplyPolicy = lineage.subagentApplyPolicy;
  if (lineage.subagentAllowedOutputPaths) {
    record.subagentAllowedOutputPaths = [...lineage.subagentAllowedOutputPaths];
  }
  if (typeof lineage.subagentRetainWorktree === 'boolean') {
    record.subagentRetainWorktree = lineage.subagentRetainWorktree;
  }
  if (lineage.subagentRole) record.subagentRole = lineage.subagentRole;
  if (lineage.worktreePath) record.worktreePath = lineage.worktreePath;
  if (lineage.worktreeBranch) record.worktreeBranch = lineage.worktreeBranch;
  if (lineage.subagentRuntime) record.subagentRuntime = lineage.subagentRuntime;
  if (lineage.subagentLifecycle) record.subagentLifecycle = lineage.subagentLifecycle;
}

export function copySubagentLineage(
  input: Parameters<typeof createSessionRecord>[0],
  lineage: SessionLineage | undefined,
): void {
  if (!lineage) {
    return;
  }
  if (lineage.subagentMode) input.subagentMode = lineage.subagentMode;
  if (lineage.subagentApplyPolicy) input.subagentApplyPolicy = lineage.subagentApplyPolicy;
  if (lineage.subagentAllowedOutputPaths) {
    input.subagentAllowedOutputPaths = [...lineage.subagentAllowedOutputPaths];
  }
  if (typeof lineage.subagentRetainWorktree === 'boolean') {
    input.subagentRetainWorktree = lineage.subagentRetainWorktree;
  }
  if (lineage.subagentRole) input.subagentRole = lineage.subagentRole;
  if (lineage.worktreePath) input.worktreePath = lineage.worktreePath;
  if (lineage.worktreeBranch) input.worktreeBranch = lineage.worktreeBranch;
  if (lineage.subagentRuntime) input.subagentRuntime = lineage.subagentRuntime;
  if (lineage.subagentLifecycle) input.subagentLifecycle = lineage.subagentLifecycle;
}
