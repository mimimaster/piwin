/**
 * Subagent lifecycle for the mock Host.
 *
 * The real orchestrator needs worker processes, git worktrees and an
 * integration coordinator, none of which a mock Host has. This stand-in
 * records a child session and pushes the same `subagent/updated` lifecycle the
 * real one does, so a shell exercises its real client path against it. It is
 * only composed in mock mode and never touches a workspace.
 */
import { randomUUID } from 'node:crypto';

import type { HostPush, SubagentBatchRequest, SubagentBatchResult } from '@piwin/contracts';
import { createSessionRecord, getSessionRecord, upsertSessionRecord } from '@piwin/session';

import { getPiwinRoot, getPiwinSessionIndexPath } from './paths.js';
import { indexRecordToSummary } from './session-summary-map.js';
import type { SubagentOrchestrator } from './subagent-orchestrator.js';
import type { SubagentBatchHandle } from './subagent-orchestrator-types.js';

const NOT_IN_MOCK = 'mock Host 不执行子代理的工作副本操作';

/**
 * Run, plan and permission paths reach the orchestrator too (abort cancels a
 * run's batches, joins wait on them). Typing these against the real class
 * keeps the one cast in host-runtime-init honest: every method the Host can
 * call exists here, as a no-op where the mock has nothing to track.
 */
type HostReachedMethods = Pick<
  SubagentOrchestrator,
  | 'cancelBatchesForParentRun'
  | 'joinBatch'
  | 'lookupBatchOwner'
  | 'getRunningInvocationActivity'
  | 'updateInvocationActivity'
>;

export type MockSubagentOrchestrator = HostReachedMethods & {
  startBatch(request: SubagentBatchRequest, parentRunId?: string): SubagentBatchHandle;
  getBatchProjectionAsync(
    runId: string,
  ): Promise<{ runId: string; status: 'completed'; results: [] }>;
  cancelBatch(runId: string): Promise<'cancelled'>;
  /** Follow-ups keep the instruction on the child and flip it back through the lifecycle. */
  continueExisting(childSessionId: string, text: string): Promise<{ runId: string }>;
};

export function createMockSubagentOrchestrator(host: {
  piwinRoot?: string;
  push: (message: HostPush) => void;
}): MockSubagentOrchestrator {
  const indexPath = (): string => getPiwinSessionIndexPath(getPiwinRoot(host.piwinRoot));

  const pushChild = async (
    parentSessionId: string,
    childSessionId: string,
    status: 'running' | 'done',
  ): Promise<void> => {
    const record = await getSessionRecord(indexPath(), childSessionId);
    if (record === undefined || record.parentSessionId !== parentSessionId) return;
    record.subagentStatus = status;
    record.updatedAt = new Date().toISOString();
    await upsertSessionRecord(indexPath(), record);
    host.push({
      type: 'subagent/updated',
      parentSessionId,
      child: indexRecordToSummary(record),
    });
  };

  const settle = async (runId: string, request: SubagentBatchRequest): Promise<void> => {
    for (const task of request.tasks) {
      const childSessionId = randomUUID();
      const record = createSessionRecord({
        id: childSessionId,
        projectPath: '',
        scope: { kind: 'general' },
        name: task.sessionName ?? task.task.slice(0, 40),
        parentSessionId: request.parentSessionId,
        depth: 1,
        kind: 'subagent',
        subagentStatus: 'running',
        task: task.task,
        subagentTaskId: task.id,
        subagentParentRunId: runId,
        subagentBatchRunId: runId,
        ...(task.role === undefined ? {} : { subagentRole: task.role }),
      });
      await upsertSessionRecord(indexPath(), record);
      host.push({
        type: 'subagent/updated',
        parentSessionId: request.parentSessionId,
        child: indexRecordToSummary(record),
      });
      record.subagentStatus = 'done';
      record.summaryPreview = `mock 子代理完成：${task.task.slice(0, 80)}`;
      record.updatedAt = new Date().toISOString();
      await upsertSessionRecord(indexPath(), record);
      host.push({
        type: 'subagent/updated',
        parentSessionId: request.parentSessionId,
        child: indexRecordToSummary(record),
      });
    }
  };

  const batches = new Map<string, Promise<SubagentBatchResult>>();

  return {
    startBatch(request) {
      const runId = randomUUID();
      const settled = settle(runId, request);
      const result: SubagentBatchResult = {
        runId,
        status: 'completed',
        results: [],
      };
      batches.set(runId, settled.then(() => result));
      return {
        runId,
        accepted: settled.then(() => undefined),
        hasAccepted: () => true,
        completion: settled.then(() => result),
      };
    },
    getBatchProjectionAsync: async (runId) => ({
      runId,
      status: 'completed' as const,
      results: [],
    }),
    cancelBatch: async () => 'cancelled' as const,
    // Batches settle on their own; there is no running work to cancel.
    cancelBatchesForParentRun: () => undefined,
    joinBatch: (runId) =>
      batches.get(runId) ?? Promise.resolve({ runId, status: 'completed', results: [] }),
    lookupBatchOwner: async () => undefined,
    getRunningInvocationActivity: () => undefined,
    updateInvocationActivity: async () => undefined,
    /**
     * Follow-ups keep the instruction as the child's last preview and flip it
     * through the lifecycle. `subagent/updated` is a projection, so a flush
     * may deliver only the final `done`. The new preview is what tells a
     * client this is another completion, not a repeat of the previous one.
     */
    async continueExisting(childSessionId: string, text: string): Promise<{ runId: string }> {
      const instruction = text.trim();
      if (instruction.length === 0) {
        throw new Error('subagent follow-up text is empty');
      }
      const record = await getSessionRecord(indexPath(), childSessionId);
      const parentSessionId = record?.parentSessionId;
      if (record === undefined || parentSessionId === undefined) {
        throw new Error(`subagent child session not found: ${childSessionId}`);
      }
      // A follow-up is a new batch, as on the real Host.
      const runId = randomUUID();
      record.lastPreview = instruction.slice(0, 160);
      record.subagentBatchRunId = runId;
      record.updatedAt = new Date().toISOString();
      await upsertSessionRecord(indexPath(), record);
      await pushChild(parentSessionId, childSessionId, 'running');
      await pushChild(parentSessionId, childSessionId, 'done');
      return { runId };
    },
  };
}

export const MOCK_SUBAGENT_WORKTREE_ERROR = NOT_IN_MOCK;
