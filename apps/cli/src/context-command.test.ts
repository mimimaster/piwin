import { describe, expect, it } from 'vitest';
import { formatContextSummary } from './context-command.js';

describe('formatContextSummary', () => {
  it('prints assembly-only rows without host paths or verified language', () => {
    const text = formatContextSummary({
      sessionId: 'session-1',
      coverage: 'assembly-only',
      summaries: [
        {
          type: 'agent/context-summary',
          sessionId: 'session-1',
          runId: 'run-1',
          requestClass: 'prompt',
          requestOrdinal: 1,
          coverage: 'assembly-only',
          estimateSource: 'host-estimate',
          totalEstimatedTokens: 12,
          contributions: [
            {
              id: 'c1',
              kind: 'context-ref',
              label: 'AGENTS.md',
              trustOrigin: 'project',
              displayPath: 'AGENTS.md',
              canOpenOnClient: false,
              redactionState: 'path',
              estimatedTokens: 8,
            },
          ],
        },
      ],
    });
    expect(text).toContain('coverage\tassembly-only');
    expect(text).toContain('~12 tokens (estimate)');
    expect(text).toContain('AGENTS.md');
    expect(text).not.toContain('/Users/');
    expect(text.toLowerCase()).not.toContain('verified');
    expect(text).not.toContain('模型实际看到');
  });
});
