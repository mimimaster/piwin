import { describe, expect, it } from 'vitest';
import { createUnknownSessionContextSnapshot } from '@piwin/contracts';
import { formatContextSummary, formatSessionContextOccupancy } from './context-command.js';

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

describe('formatSessionContextOccupancy', () => {
  it('prints 已确认/估算/未知 from a Host snapshot', () => {
    expect(
      formatSessionContextOccupancy(
        createUnknownSessionContextSnapshot({
          sessionId: 's1',
          revision: 1,
          contextVersion: 1,
          contextBoundary: { activeLeafMessageId: null },
          reason: 'never-sampled',
          updatedAt: '2026-08-30T00:00:00.000Z',
        }),
      ),
    ).toContain('未知');
    expect(
      formatSessionContextOccupancy({
        sessionId: 's1',
        revision: 2,
        contextVersion: 1,
        contextBoundary: { activeLeafMessageId: null },
        responseEvidence: {
          currentRunHasResponse: true,
          historyHasDisplayableResponse: true,
        },
        phase: 'idle',
        occupancy: {
          kind: 'known',
          tokensUsed: 90_000,
          tokensLimit: 128_000,
          quality: 'measured',
          coverage: 'complete',
          basis: 'test',
          sampledAt: '2026-08-30T00:00:00.000Z',
        },
        updatedAt: '2026-08-30T00:00:00.000Z',
      }),
    ).toContain('已确认');
    expect(
      formatSessionContextOccupancy(
        {
          sessionId: 's1',
          revision: 3,
          contextVersion: 1,
          contextBoundary: { activeLeafMessageId: null },
          responseEvidence: {
            currentRunHasResponse: true,
            historyHasDisplayableResponse: true,
          },
          phase: 'streaming',
          occupancy: {
            kind: 'known',
            tokensUsed: 12,
            quality: 'estimated',
            coverage: 'partial',
            basis: 'test',
            sampledAt: '2026-08-30T00:00:00.000Z',
          },
          updatedAt: '2026-08-30T00:00:00.000Z',
        },
        'en',
      ),
    ).toContain('estimated');
  });
});
