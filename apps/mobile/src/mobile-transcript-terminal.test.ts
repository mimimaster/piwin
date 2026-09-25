import { describe, expect, it } from 'vitest';
import { applyRunTerminal, type MobileTranscriptMessage } from './mobile-transcript.js';

const live: MobileTranscriptMessage[] = [
  { id: 'u1', role: 'user', text: 'go', createdAt: '2026-09-25T10:00:00.000Z', status: 'done' },
  {
    id: 'a1',
    role: 'assistant',
    text: '',
    createdAt: '2026-09-25T10:00:01.000Z',
    status: 'streaming',
    runId: 'r1',
    toolCalls: [{ id: 't1', name: 'bash', status: 'running' }],
  },
];

describe('applyRunTerminal', () => {
  it('marks a stopped run cancelled and closes its running tools', () => {
    const next = applyRunTerminal(live, {
      runId: 'r1',
      kind: 'session-turn',
      status: 'cancelled',
      rootRunId: 'r1',
      sessionId: 's1',
      endedAt: '2026-09-25T10:00:07.000Z',
    });
    expect(next[1]).toMatchObject({ outcome: 'cancelled', status: 'done', endedAt: '2026-09-25T10:00:07.000Z' });
    expect(next[1]?.toolCalls?.[0]).toMatchObject({ status: 'error', error: '已停止' });
    expect(next[0]).toBe(live[0]);
  });

  it('carries the Host failure message onto a failed run', () => {
    const next = applyRunTerminal(live, {
      runId: 'r1',
      kind: 'session-turn',
      status: 'failed',
      rootRunId: 'r1',
      sessionId: 's1',
      error: 'provider quota',
    });
    expect(next[1]).toMatchObject({ outcome: 'failed', terminalMessage: 'provider quota' });
  });
});
