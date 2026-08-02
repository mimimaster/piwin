import type { SessionIndexRecord, SessionScope, SessionSummary } from '@piwin/contracts';
import { scopeFromIndexRecord, workingDirectoryFromIndexRecord } from './session-scope.js';

/** Map product session index records to IPC SessionSummary. */
export function indexRecordToSummary(
  record: Pick<
    SessionIndexRecord,
    | 'id'
    | 'projectPath'
    | 'scope'
    | 'workingDirectory'
    | 'name'
    | 'updatedAt'
    | 'messageCount'
    | 'lastPreview'
    | 'parentSessionId'
    | 'depth'
    | 'kind'
    | 'subagentStatus'
    | 'task'
    | 'mergedAt'
    | 'mergeMessageId'
    | 'summaryPreview'
    | 'isPinned'
    | 'pinnedAt'
    | 'isArchived'
    | 'archivedAt'
    | 'subagentMode'
    | 'subagentApplyPolicy'
    | 'worktreePath'
    | 'worktreeBranch'
    | 'subagentRuntime'
    | 'subagentLifecycle'
  >,
): SessionSummary {
  const scope: SessionScope = scopeFromIndexRecord(record);
  const workingDirectory = workingDirectoryFromIndexRecord(record);
  const summary: SessionSummary = {
    id: record.id,
    scope,
    workingDirectory,
    projectPath: record.projectPath,
    updatedAt: record.updatedAt,
    messageCount: record.messageCount,
  };
  if (record.name) summary.name = record.name;
  if (record.lastPreview) summary.lastPreview = record.lastPreview;
  if (record.parentSessionId) summary.parentSessionId = record.parentSessionId;
  if (typeof record.depth === 'number') summary.depth = record.depth;
  if (record.kind) summary.kind = record.kind;
  if (record.subagentStatus) summary.subagentStatus = record.subagentStatus;
  if (record.task) summary.task = record.task;
  if (record.mergedAt) summary.mergedAt = record.mergedAt;
  if (record.mergeMessageId) summary.mergeMessageId = record.mergeMessageId;
  if (record.summaryPreview) summary.summaryPreview = record.summaryPreview;
  if (record.isPinned === true) summary.isPinned = true;
  if (record.pinnedAt) summary.pinnedAt = record.pinnedAt;
  if (record.isArchived === true) summary.isArchived = true;
  if (record.archivedAt) summary.archivedAt = record.archivedAt;
  if (record.subagentMode) summary.subagentMode = record.subagentMode;
  if (record.subagentApplyPolicy) summary.subagentApplyPolicy = record.subagentApplyPolicy;
  if (record.worktreePath) summary.worktreePath = record.worktreePath;
  if (record.worktreeBranch) summary.worktreeBranch = record.worktreeBranch;
  // CE-SUB-PROF: safe projection of runtime snapshot (no secrets/skill bodies).
  const snapshot = record.subagentRuntime;
  if (snapshot) {
    if (snapshot.profileId) summary.subagentProfileId = snapshot.profileId;
    if (snapshot.model) summary.subagentModel = snapshot.model;
    if (snapshot.thinkingLevel) summary.subagentThinkingLevel = snapshot.thinkingLevel;
    if (!summary.subagentMode) summary.subagentMode = snapshot.isolation;
  }
  // CE-SUB-LIFE: orthogonal state axes.
  const lifecycle = record.subagentLifecycle;
  if (lifecycle) {
    summary.subagentExecutionStatus = lifecycle.executionStatus;
    summary.subagentSummaryStatus = lifecycle.summaryStatus;
    summary.subagentIntegrationStatus = lifecycle.integrationStatus;
  }
  return summary;
}
