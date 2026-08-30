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

  it('does not throw on an unknown inner HostPush type', () => {
    const encoded = JSON.stringify({
      type: 'push',
      seq: 4,
      eventId: 'event-unknown',
      push: { type: 'future/unknown-telemetry', sessionId: 'session-1' },
    });
    expect(() => decodeHostWireMessage(encoded)).not.toThrow();
    const decoded = decodeHostWireMessage(encoded);
    expect(decoded).toMatchObject({
      type: 'push',
      push: { type: 'future/unknown-telemetry', sessionId: 'session-1' },
    });
  });
});
