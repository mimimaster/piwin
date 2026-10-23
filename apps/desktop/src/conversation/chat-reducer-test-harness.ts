import type { ExecutionRunRecord } from '@piwin/contracts';

export function makeRun(
  runId: string,
  overrides: Partial<ExecutionRunRecord> = {},
): ExecutionRunRecord {
  return {
    runId,
    kind: 'session-turn',
    status: 'running',
    rootRunId: runId,
    sessionId: 's1',
    startedAt: '2026-07-24T00:00:00.000Z',
    ...overrides,
  };
}
