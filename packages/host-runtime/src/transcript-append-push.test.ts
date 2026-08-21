import { describe, expect, it } from 'vitest';
import { USER_AUTHORED_GENERATION } from '@piwin/contracts';
import { transcriptAppendPush } from './transcript-append-push.js';

describe('transcriptAppendPush', () => {
  it('wraps a persisted user row for every attached shell', () => {
    expect(
      transcriptAppendPush('session-1', {
        id: 'user-1',
        role: 'user',
        text: 'hello',
        status: 'done',
        createdAt: '2026-08-20T00:00:00.000Z',
        runtimeGenerationId: USER_AUTHORED_GENERATION,
      }),
    ).toEqual({
      type: 'transcript/append',
      sessionId: 'session-1',
      message: {
        id: 'user-1',
        role: 'user',
        text: 'hello',
        status: 'done',
        createdAt: '2026-08-20T00:00:00.000Z',
        runtimeGenerationId: USER_AUTHORED_GENERATION,
      },
    });
  });
});
