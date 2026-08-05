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
