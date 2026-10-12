import type { QueuedTurnRecord, RunInterventionRecord } from '@piwin/contracts';

export function queued(id: string, text: string, extra: Partial<QueuedTurnRecord> = {}): QueuedTurnRecord {
  return {
    queuedTurnId: id, revision: 1, sessionId: 's1', sequence: Number(id.replace(/\D/g, '') || 0), userMessageId: `u-${id}`,
    mode: 'next', status: 'pending', input: { text }, submittedAt: '', updatedAt: '', ...extra,
  } as QueuedTurnRecord;
}

export function steer(id: string, status: RunInterventionRecord['status'], text = '先看测试'): RunInterventionRecord {
  return {
    interventionId: id, revision: 1, sessionId: 's1', runId: 'r1', runtimeGenerationId: 'g', sequence: 1,
    userMessageId: `u-${id}`, status, input: { text }, submittedAt: '', updatedAt: '',
  } as RunInterventionRecord;
}

