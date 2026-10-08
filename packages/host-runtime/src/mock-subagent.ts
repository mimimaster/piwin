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
import type { SubagentBatchHandle } from './subagent-orchestrator-types.js';

const NOT_IN_MOCK = 'mock Host 不执行子代理的工作副本操作';

// Same-child `subagent/updated` pushes are projections: the egress hub
// keeps only the latest one until its flush (24ms). A mock that emits
// running and done in the same turn would only deliver done, so a
// follow-up that was already done would never announce again.
const STATUS_GAP_MS = 40;
const waitForStatusFlush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, STATUS_GAP_MS));

export type MockSubagentOrchestrator = {
  startBatch(request: SubagentBatchRequest, parentRunId?: string): SubagentBatchHandle;
  getBatchProjectionAsync(
    runId: string,
  ): Promise<{ runId: string; status: 'completed'; results: [] }>;
  cancelBatch(runId: string): Promise<'cancelled'>;
  /** Follow-ups flip the existing child back through the lifecycle. */
  continueExisting(childSessionId: string): Promise<{ runId: string }>;
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
        ...(task.role === undefined ? {} : { subagentRole: task.role }),
      });
      await upsertSessionRecord(indexPath(), record);
      host.push({
        type: 'subagent/updated',
        parentSessionId: request.parentSessionId,
        child: indexRecordToSummary(record),
      });
      await waitForStatusFlush();
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

  return {
    startBatch(request) {
      const runId = randomUUID();
      const settled = settle(runId, request);
      const result: SubagentBatchResult = {
        runId,
        status: 'completed',
        results: [],
      };
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
    /** Follow-ups flip the existing child back through the lifecycle. */
    async continueExisting(childSessionId: string): Promise<{ runId: string }> {
      const record = await getSessionRecord(indexPath(), childSessionId);
      const parentSessionId = record?.parentSessionId;
      if (parentSessionId === undefined) {
        throw new Error(`subagent child session not found: ${childSessionId}`);
      }
      await pushChild(parentSessionId, childSessionId, 'running');
      await waitForStatusFlush();
      await pushChild(parentSessionId, childSessionId, 'done');
      return { runId: randomUUID() };
    },
  };
}

export const MOCK_SUBAGENT_WORKTREE_ERROR = NOT_IN_MOCK;
