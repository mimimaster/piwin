import { describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse, QueuedTurnRecord } from '@piwin/contracts';
import {
  runSessionQueueCancel,
  runSessionQueueEdit,
  runSessionQueueList,
  runSessionQueueReorder,
  runSessionReplaceRun,
  type SessionQueueHostClient,
} from './session-queue-command.js';

function queuedTurn(overrides: Partial<QueuedTurnRecord> = {}): QueuedTurnRecord {
  return {
    queuedTurnId: 'queued-1',
    revision: 3,
    sessionId: 'session-1',
    sequence: 1,
    userMessageId: 'user-1',
    mode: 'next',
    status: 'pending',
    input: { text: 'old text', clientMessageId: 'user-1' },
    submittedAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:01.000Z',
    ...overrides,
  };
}

function createClient(responses: HostResponse[]): SessionQueueHostClient & {
  handleCommand: ReturnType<typeof vi.fn>;
} {
  return {
    handleCommand: vi.fn(async (_command: HostCommand) => {
      const response = responses.shift();
      if (!response) throw new Error('no fixture response');
      return response;
    }),
  };
}

describe('session queue CLI helpers', () => {
  it('lists the durable queue projection', async () => {
    const client = createClient([
      {
        type: 'response',
        command: 'session/queued-turn-list',
        success: true,
        data: { queueRevision: 7, queuedTurns: [queuedTurn()] },
      },
    ]);
    const print = vi.fn();
    const result = await runSessionQueueList(client, 'session-1', print);
    expect(result.queueRevision).toBe(7);
    expect(client.handleCommand).toHaveBeenCalledWith({
      type: 'session/queued-turn-list',
      sessionId: 'session-1',
    });
    expect(print).toHaveBeenCalledWith(expect.stringContaining('queued-1'));
  });

  it('reads the current revision before editing and preserves frozen input fields', async () => {
    const current = queuedTurn({
      input: {
        text: 'old text',
        clientMessageId: 'user-1',
        agentMode: 'plan',
      },
    });
    const updated = queuedTurn({ revision: 4, input: { ...current.input, text: 'new text' } });
    const client = createClient([
      {
        type: 'response',
        command: 'session/queued-turn-list',
        success: true,
        data: { queueRevision: 7, queuedTurns: [current] },
      },
      {
        type: 'response',
        command: 'session/queued-turn-edit',
        success: true,
        data: { queuedTurn: updated },
      },
    ]);

    await runSessionQueueEdit(client, 'session-1', 'queued-1', 'new text');
    expect(client.handleCommand).toHaveBeenLastCalledWith({
      type: 'session/queued-turn-edit',
      sessionId: 'session-1',
      queuedTurnId: 'queued-1',
      expectedRevision: 3,
      input: {
        text: 'new text',
        clientMessageId: 'user-1',
        agentMode: 'plan',
      },
    });
  });

  it('uses queue revision for reorder and exposes Host conflicts', async () => {
    const client = createClient([
      {
        type: 'response',
        command: 'session/queued-turn-list',
        success: true,
        data: { queueRevision: 12, queuedTurns: [] },
      },
      {
        type: 'response',
        command: 'session/queued-turn-reorder',
        success: false,
        error: 'queued-turn-revision-conflict',
      },
    ]);

    await expect(
      runSessionQueueReorder(client, 'session-1', ['queued-2', 'queued-1']),
    ).rejects.toThrow('queued-turn-revision-conflict');
    expect(client.handleCommand).toHaveBeenLastCalledWith({
      type: 'session/queued-turn-reorder',
      sessionId: 'session-1',
      expectedQueueRevision: 12,
      orderedQueuedTurnIds: ['queued-2', 'queued-1'],
    });
  });

  it('sends explicit cancellation and Replace identities', async () => {
    const current = queuedTurn();
    const client = createClient([
      {
        type: 'response',
        command: 'session/queued-turn-list',
        success: true,
        data: { queueRevision: 7, queuedTurns: [current] },
      },
      {
        type: 'response',
        command: 'session/queued-turn-cancel',
        success: true,
        data: { queuedTurn: { ...current, status: 'cancelled', revision: 4 } },
      },
      {
        type: 'response',
        command: 'session/replace-run',
        success: true,
        data: {
          queuedTurn: queuedTurn({ mode: 'replace', replaceRunId: 'run-1' }),
        },
      },
    ]);

    await runSessionQueueCancel(client, 'session-1', 'queued-1');
    await runSessionReplaceRun(client, 'session-1', 'run-1', 'replace text', {
      queuedTurnId: 'queued-replace',
      userMessageId: 'user-replace',
    });
    expect(client.handleCommand).toHaveBeenLastCalledWith({
      type: 'session/replace-run',
      sessionId: 'session-1',
      runId: 'run-1',
      queuedTurnId: 'queued-replace',
      userMessageId: 'user-replace',
      input: { text: 'replace text', clientMessageId: 'user-replace' },
    });
  });
});
