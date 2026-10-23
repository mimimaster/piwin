import { describe, expect, it } from 'vitest';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import { buildRunRecordsFromTranscriptMessages } from './chat-reducer-transcript';

describe('buildRunRecordsFromTranscriptMessages', () => {
  it('hydrates a completed length stop so truncation chrome can survive reload', () => {
    const messages: SessionTranscriptMessage[] = [
      {
        id: 'a-len',
        role: 'assistant',
        text: '<!DOCTYPE html>',
        createdAt: '2026-09-08T13:18:37.000Z',
        status: 'done',
        runId: 'run-len',
        outcome: 'completed',
        agentStopReason: 'length',
      },
    ];
    const records = buildRunRecordsFromTranscriptMessages(messages);
    expect(records['run-len']).toMatchObject({
      runId: 'run-len',
      outcome: 'completed',
      agentStopReason: 'length',
    });
  });
});
