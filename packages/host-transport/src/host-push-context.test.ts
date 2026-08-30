import { describe, expect, it } from 'vitest';
import type { HostPushVariant, SessionContextSnapshot } from '@piwin/contracts';
import { createUnknownSessionContextSnapshot } from '@piwin/contracts';
import { classifyHostPush } from './host-push-policy.js';
import { classifyHostPushAudience } from './host-push-audience.js';

function unknownSnapshot(): SessionContextSnapshot {
  return createUnknownSessionContextSnapshot({
    sessionId: 'session-1',
    revision: 1,
    contextVersion: 1,
    contextBoundary: { activeLeafMessageId: null },
    reason: 'never-sampled',
    updatedAt: '2026-08-30T00:00:00.000Z',
  });
}

describe('session/context-updated push policy', () => {
  it('classifies context updates as a session projection keyed by sessionId', () => {
    const push: HostPushVariant = {
      type: 'session/context-updated',
      sessionId: 'session-1',
      snapshot: unknownSnapshot(),
    };
    expect(classifyHostPush(push)).toEqual({
      kind: 'projection',
      key: ['session', 'session-1', 'context'],
    });
    expect(classifyHostPushAudience(push)).toEqual({ kind: 'session', sessionId: 'session-1' });
  });

  it('keeps compaction, branch, and invalidation as barriers until WP3 live emission', () => {
    expect(
      classifyHostPush({ type: 'event', sessionId: 'session-1', event: { type: 'compaction/start' } }),
    ).toEqual({
      kind: 'control',
      barrierKeys: [['session', 'session-1', 'lifecycle']],
    });
    expect(
      classifyHostPush({
        type: 'event',
        sessionId: 'session-1',
        event: { type: 'compaction/end', ok: true },
      }),
    ).toEqual({
      kind: 'control',
      barrierKeys: [['session', 'session-1', 'lifecycle']],
    });
    expect(
      classifyHostPush({
        type: 'session/branch-updated',
        sessionId: 'session-1',
        activeLeafMessageId: 'leaf-2',
        branchPointCount: 1,
      }).kind,
    ).toBe('projection');
  });

  it('does not journal context/measurement as a billing usage projection', () => {
    expect(
      classifyHostPush({
        type: 'event',
        sessionId: 'session-1',
        event: {
          type: 'context/measurement',
          measurement: {
            sessionId: 'session-1',
            sampleSequence: 1,
            occupancy: { kind: 'unknown', reason: 'synthetic' },
            contextBoundary: { activeLeafMessageId: null },
            sampledAt: '2026-08-30T00:00:00.000Z',
          },
        },
      }).kind,
    ).not.toBe('append');
  });
});
