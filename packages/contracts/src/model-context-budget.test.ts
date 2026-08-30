import { describe, expect, it } from 'vitest';
import { createUnknownSessionContextSnapshot } from './context-telemetry.js';
import {
  estimatePendingPromptTokens,
  readContextOccupiedTokens,
  resolveModelContextBudget,
} from './model-context-budget.js';

describe('model context budget', () => {
  it('uses an 80 percent soft input budget for a 252K target', () => {
    expect(resolveModelContextBudget({ contextWindow: 252_000, maxOutputTokens: 8_000 })).toEqual({
      contextWindow: 252_000,
      outputReserve: 8_000,
      safetyReserve: 12_600,
      inputBudget: 201_600,
    });
  });

  it('falls back from cumulative occupancy to prompt and total tokens', () => {
    const base = { sessionId: 's1', updatedAt: new Date(0).toISOString() };
    expect(readContextOccupiedTokens({ ...base, tokensUsed: 42 })).toBe(42);
    expect(readContextOccupiedTokens({ ...base, promptTokens: 43 })).toBe(43);
    expect(readContextOccupiedTokens({ ...base, totalTokens: 44 })).toBe(44);
    expect(readContextOccupiedTokens({ ...base, contextRatio: 0.5, tokensLimit: 100 })).toBe(50);
  });

  it('uses Host snapshot occupancy and does not treat unknown as 0', () => {
    expect(
      readContextOccupiedTokens({
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
          quality: 'measured',
          coverage: 'complete',
          basis: 'input-plus-output',
          sampledAt: '2026-08-30T00:00:00.000Z',
        },
        updatedAt: '2026-08-30T00:00:00.000Z',
      }),
    ).toBe(90_000);
    expect(
      readContextOccupiedTokens(
        createUnknownSessionContextSnapshot({
          sessionId: 's1',
          revision: 1,
          contextVersion: 1,
          contextBoundary: { activeLeafMessageId: null },
          reason: 'never-sampled',
          updatedAt: '2026-08-30T00:00:00.000Z',
        }),
      ),
    ).toBeUndefined();
  });

  it('reserves room for attachments and context references in a pending turn', () => {
    expect(
      estimatePendingPromptTokens({ text: '12345678', attachmentCount: 2, contextRefCount: 1 }),
    ).toBe(3_074);
  });
});
