import { describe, expect, it } from 'vitest';
import type { SubagentBatchRequest } from '@piwin/contracts';
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

  it('routes an explicit worktree action through the injected seam', async () => {
    const actions: string[] = [];
    const response = await handleSubagentCommand(
      { type: 'subagent/worktree-action', childSessionId: 'child-1', action: 'discard' },
      'request-worktree',
      {
        ...context,
        actOnWorktree: async (childSessionId, action) => {
          actions.push(`${childSessionId}:${action}`);
          return { integrationStatus: 'discarded' };
        },
      },
    );

    expect(actions).toEqual(['child-1:discard']);
    expect(response).toMatchObject({
      success: true,
      command: 'subagent/worktree-action',
      data: {
        childSessionId: 'child-1',
        action: 'discard',
        integrationStatus: 'discarded',
      },
    });
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
});
