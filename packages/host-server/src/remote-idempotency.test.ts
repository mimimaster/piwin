import { describe, expect, it } from 'vitest';
import type { HostCommand } from '@piwin/contracts';
import { createRemoteCommandDigest } from './remote-idempotency.js';

describe('createRemoteCommandDigest', () => {
  const body: HostCommand = {
    type: 'session/prompt',
    sessionId: 's1',
    input: { text: 'once' },
    foreground: { kind: 'if-idle' },
  };

  it('ignores transport command.id so the same gesture retries replay', () => {
    const first = createRemoteCommandDigest({ ...body, id: 'request-1' });
    const second = createRemoteCommandDigest({ ...body, id: 'request-2' });
    expect(first).toBe(second);
  });

  it('conflicts when the same key is bound to a different command body', () => {
    const other: HostCommand = {
      ...body,
      input: { text: 'different' },
    };
    expect(createRemoteCommandDigest(body)).not.toBe(createRemoteCommandDigest(other));
  });
});
