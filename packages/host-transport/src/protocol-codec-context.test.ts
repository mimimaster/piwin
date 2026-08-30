import { describe, expect, it } from 'vitest';
import { createUnknownSessionContextSnapshot } from '@piwin/contracts';
import { decodeHostWireMessage, encodeHostWireMessage } from './protocol-codec.js';

describe('Host wire codec context telemetry', () => {
  it('round-trips session/context-updated without throwing', () => {
    const frame = {
      type: 'push' as const,
      seq: 9,
      eventId: 'event-9',
      push: {
        type: 'session/context-updated' as const,
        sessionId: 'session-1',
        snapshot: createUnknownSessionContextSnapshot({
          sessionId: 'session-1',
          revision: 1,
          contextVersion: 1,
          contextBoundary: { activeLeafMessageId: null },
          reason: 'never-sampled',
          updatedAt: '2026-08-30T00:00:00.000Z',
        }),
      },
    };
    expect(decodeHostWireMessage(encodeHostWireMessage(frame))).toEqual(frame);
  });
});
