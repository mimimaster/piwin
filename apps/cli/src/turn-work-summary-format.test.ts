import { expect, it } from 'vitest';
import { formatTurnWorkSummary } from './turn-work-summary-format.js';

it('prints Host totals and keeps an unknown duration unknown', () => {
  const summary = {
    turnId: 'turn-user',
    userMessageId: 'user',
    firstMessageId: 'user',
    revision: 'rev',
    startIndex: 0,
    endIndex: 900,
    toolCount: 934,
    fileCount: 141,
    failureCount: 15,
  };
  expect(formatTurnWorkSummary(summary)).toBe(
    '- turn: turn-user\n- tools: 934\n- files: 141\n- failures: 15',
  );
  expect(formatTurnWorkSummary({ ...summary, elapsedMs: 190000 })).toContain('- worked: 190000ms');
});
