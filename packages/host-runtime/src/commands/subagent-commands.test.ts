import { describe, expect, it } from 'vitest';
import {
  emptySubagentResultReviewFields,
  type SubagentBatchRequest,
  type SubagentResultSummary,
} from '@piwin/contracts';
import { createSubagentResultService } from '../subagent-result-service.js';
import { handleSubagentCommand } from './subagent-commands.js';

const request: SubagentBatchRequest = {
  parentSessionId: 'session-1',
  tasks: [
    {
      id: 'task-1',
      parentSessionId: 'session-1',
      task: 'inspect the project',
    },
  ],
};

describe('subagent command handlers', () => {
  const context = {
    prepareBatch: async (input: SubagentBatchRequest) => input,
    startBatch: () => ({ runId: 'run-1' }),
    getBatchProjection: async () => ({
      runId: 'run-1',
      status: 'running' as const,
      results: [],
    }),
    cancelBatch: async () => {},
    continueChild: async () => ({ runId: 'continuation-run' }),
    actOnWorktree: async () => ({ integrationStatus: 'retained' as const }),
  };

  it('starts a batch through the injected orchestration seam', async () => {
    const started: string[] = [];
    const response = await handleSubagentCommand(
      { type: 'subagent/batch-start', request },
      'request-1',
      {
        prepareBatch: async (input) => input,
        startBatch: () => {
          started.push('task-1');
          return { runId: 'run-1' };
        },
        getBatchProjection: async () => ({
          runId: 'run-1',
          status: 'running',
          results: [],
        }),
        cancelBatch: async () => {},
        continueChild: async () => ({ runId: 'continuation-run' }),
        actOnWorktree: async () => ({ integrationStatus: 'retained' as const }),
      },
    );

    expect(started).toEqual(['task-1']);
    expect(response).toMatchObject({
      id: 'request-1',
      type: 'response',
      command: 'subagent/batch-start',
      success: true,
      data: { runId: 'run-1' },
    });
  });

  it('accepts a bounded child continuation through the injected seam', async () => {
    const continued: string[] = [];
    const response = await handleSubagentCommand(
      { type: 'subagent/continue', childSessionId: 'child-1', text: 'Check the tests' },
      'request-continue',
      {
        ...context,
        continueChild: async (childSessionId, text) => {
          continued.push(`${childSessionId}:${text}`);
          return { runId: 'continuation-run' };
        },
      },
    );

    expect(continued).toEqual(['child-1:Check the tests']);
    expect(response).toMatchObject({
      success: true,
      command: 'subagent/continue',
      data: { runId: 'continuation-run', childSessionId: 'child-1' },
    });
  });

  it('rejects an empty continuation before invoking the seam', async () => {
    const response = await handleSubagentCommand(
      { type: 'subagent/continue', childSessionId: 'child-1', text: '   ' },
      undefined,
      context,
    );
    expect(response).toMatchObject({ success: false, command: 'subagent/continue' });
  });

  it('routes an explicit retain through the injected seam', async () => {
    const actions: string[] = [];
    const response = await handleSubagentCommand(
      { type: 'subagent/worktree-action', childSessionId: 'child-1', action: 'retain' },
      'request-worktree',
      {
        ...context,
        actOnWorktree: async (childSessionId, action) => {
          actions.push(`${childSessionId}:${action}`);
          return { integrationStatus: 'retained' };
        },
      },
    );

    expect(actions).toEqual(['child-1:retain']);
    expect(response).toMatchObject({
      success: true,
      command: 'subagent/worktree-action',
      data: {
        childSessionId: 'child-1',
        action: 'retain',
        integrationStatus: 'retained',
      },
    });
  });

  it('refuses childSessionId-only apply and discard without result identity', async () => {
    const actions: string[] = [];
    const contextWithProbe = {
      ...context,
      actOnWorktree: async (childSessionId: string, action: 'apply' | 'retain' | 'discard') => {
        actions.push(`${childSessionId}:${action}`);
        return { integrationStatus: 'applied' as const };
      },
    };
    for (const action of ['apply', 'discard'] as const) {
      const response = await handleSubagentCommand(
        { type: 'subagent/worktree-action', childSessionId: 'child-1', action },
        `request-${action}`,
        contextWithProbe,
      );
      expect(response).toMatchObject({
        success: false,
        command: 'subagent/worktree-action',
        error: 'upgrade-required',
        problem: { code: 'upgrade-required' },
      });
    }
    expect(actions).toEqual([]);
  });

  it('returns a stable not-ready response without an orchestration seam', async () => {
    const response = await handleSubagentCommand(
      { type: 'subagent/batch-status', runId: 'run-1' },
      undefined,
      undefined,
    );
    expect(response).toMatchObject({
      type: 'response',
      command: 'subagent/batch-status',
      success: false,
    });
  });

  it('returns unsupported-capability for result commands until W5', async () => {
    const commands: Parameters<typeof handleSubagentCommand>[0][] = [
      { type: 'subagent/results', parentSessionId: 'session-1' },
      { type: 'subagent/result', resultId: 'result-1' },
      { type: 'subagent/result-files', resultId: 'result-1', revision: 1 },
      { type: 'subagent/result-diff', resultId: 'result-1', revision: 1, fileId: 'file-1' },
      { type: 'subagent/cleanup-plan', resultId: 'result-1', expectedRevision: 1 },
      {
        type: 'subagent/request-resolution',
        resultId: 'result-1',
        expectedRevision: 1,
        purpose: 'resolve',
      },
      { type: 'subagent/worktree-action', action: 'apply', resultId: 'result-1', expectedRevision: 1 },
    ];
    for (const command of commands) {
      const response = await handleSubagentCommand(command, 'request-result', context);
      expect(response).toMatchObject({
        success: false,
        command: command.type,
        error: 'unsupported-capability',
        problem: { code: 'unsupported-capability' },
      });
    }
  });

  it('serves result commands when a resultService is injected', async () => {
    const service = createSubagentResultService();
    const summary = makeResultSummary();
    service.register(summary, { worktreePath: '/tmp/child-wt' });
    const started: string[] = [];
    const applied: string[] = [];
    const withService = {
      ...context,
      resultService: service,
      startParentPrompt: async (input: { parentSessionId: string; text: string; resultId: string }) => {
        started.push(`${input.parentSessionId}:${input.resultId}`);
        return { runId: 'parent-run' };
      },
      applyResult: async (input: { resultId: string; expectedRevision: number }) => {
        applied.push(`${input.resultId}:${String(input.expectedRevision)}`);
        return { operationId: 'op-1' };
      },
    };

    const results = await handleSubagentCommand(
      { type: 'subagent/results', parentSessionId: 'session-1' },
      'request-results',
      withService,
    );
    expect(results).toMatchObject({
      success: true,
      command: 'subagent/results',
      data: { items: [summary] },
    });

    const result = await handleSubagentCommand(
      { type: 'subagent/result', resultId: 'result-1' },
      'request-result',
      withService,
    );
    expect(result).toMatchObject({ success: true, command: 'subagent/result', data: summary });

    const files = await handleSubagentCommand(
      { type: 'subagent/result-files', resultId: 'result-1', revision: 1 },
      'request-files',
      withService,
    );
    expect(files).toMatchObject({
      success: true,
      command: 'subagent/result-files',
      data: { files: [] },
    });

    const diff = await handleSubagentCommand(
      { type: 'subagent/result-diff', resultId: 'result-1', revision: 1, fileId: 'file-1' },
      'request-diff',
      withService,
    );
    expect(diff).toMatchObject({
      success: true,
      command: 'subagent/result-diff',
    });

    const cleanup = await handleSubagentCommand(
      { type: 'subagent/cleanup-plan', resultId: 'result-1', expectedRevision: 1 },
      'request-cleanup',
      withService,
    );
    expect(cleanup).toMatchObject({
      success: true,
      command: 'subagent/cleanup-plan',
      data: { worktreePath: '/tmp/child-wt' },
    });

    const resolution = await handleSubagentCommand(
      {
        type: 'subagent/request-resolution',
        resultId: 'result-1',
        expectedRevision: 1,
        purpose: 'resolve',
      },
      'request-resolution',
      withService,
    );
    expect(resolution).toMatchObject({
      success: true,
      command: 'subagent/request-resolution',
      data: { runId: 'parent-run' },
    });
    expect(started).toEqual(['session-1:result-1']);

    const apply = await handleSubagentCommand(
      { type: 'subagent/worktree-action', action: 'apply', resultId: 'result-1', expectedRevision: 1 },
      'request-apply',
      withService,
    );
    expect(apply).toMatchObject({
      success: true,
      command: 'subagent/worktree-action',
      data: { operationId: 'op-1', action: 'apply', resultId: 'result-1' },
    });
    expect(applied).toEqual(['result-1:1']);
  });

  it('rejects a result worktree apply that omits expectedRevision', async () => {
    const response = await handleSubagentCommand(
      { type: 'subagent/worktree-action', action: 'apply', resultId: 'result-1' },
      'request-upgrade',
      context,
    );
    expect(response).toMatchObject({
      success: false,
      command: 'subagent/worktree-action',
      error: 'upgrade-required',
      problem: { code: 'upgrade-required' },
    });
  });
});

function makeResultSummary(): SubagentResultSummary {
  return {
    resultId: 'result-1',
    revision: 1,
    parentSessionId: 'session-1',
    childSessionId: 'child-1',
    taskId: 'task-1',
    batchRunId: 'run-1',
    sourceAttemptId: null,
    targetWorkspaceId: 'ws-1',
    deliveryIntent: 'candidate',
    legacyManual: false,
    candidateGroupId: null,
    ...emptySubagentResultReviewFields(),
    latestReview: { reviewId: 'rev-1', revision: 1 },
    reviewStatus: 'approved',
    executionStatus: 'completed',
    summaryStatus: 'merged',
    integrationStatus: 'retained',
    childChanges: { changeSetId: 'cs-child', revision: 1 },
    appliedChanges: null,
    copyState: 'present',
    latestOperationId: null,
    availability: {
      view: { allowed: true },
      apply: { allowed: true },
      resolve: { allowed: true },
      cleanup: { allowed: true },
    },
  };
}
