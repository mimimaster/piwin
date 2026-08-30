import type {
  AssistantUsageMeasurement,
  SessionContextSnapshot,
} from '@piwin/contracts';

export function makeContextSnapshot(
  overrides: Partial<SessionContextSnapshot> & { sessionId?: string } = {},
): SessionContextSnapshot {
  const sessionId = overrides.sessionId ?? 'session-a';
  return {
    sessionId,
    revision: 1,
    contextVersion: 1,
    contextBoundary: { activeLeafMessageId: null },
    responseEvidence: {
      currentRunHasResponse: false,
      historyHasDisplayableResponse: false,
    },
    phase: 'empty',
    occupancy: { kind: 'unknown', reason: 'never-sampled' },
    updatedAt: '2026-08-30T00:00:00.000Z',
    ...overrides,
  };
}

export function makeKnownOccupancy(input: {
  tokensUsed: number;
  tokensLimit?: number;
  quality?: 'measured' | 'estimated';
  sampledAt?: string;
}): Extract<SessionContextSnapshot['occupancy'], { kind: 'known' }> {
  return {
    kind: 'known',
    tokensUsed: input.tokensUsed,
    quality: input.quality ?? 'measured',
    coverage: 'complete',
    basis: 'test',
    sampledAt: input.sampledAt ?? '2026-08-30T00:00:00.000Z',
    ...(input.tokensLimit !== undefined ? { tokensLimit: input.tokensLimit } : {}),
  };
}

export function makeLastRequest(
  overrides: Partial<AssistantUsageMeasurement> = {},
): AssistantUsageMeasurement {
  return {
    measurementId: 'meas-1',
    sessionId: 'session-a',
    messageId: 'assistant-1',
    totalTokens: 100,
    recordedAt: '2026-08-30T00:00:00.000Z',
    ...overrides,
  };
}
