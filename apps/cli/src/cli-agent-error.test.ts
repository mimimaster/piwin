import { describe, expect, it } from 'vitest';
import { formatCliAgentErrorEvent, formatCliAgentFailure } from './cli-agent-error.js';

describe('formatCliAgentFailure', () => {
  it('prints structured code, origin, and bounded detail', () => {
    expect(
      formatCliAgentFailure({
        code: 'provider-authentication',
        origin: 'provider',
        message: '401 unauthorized',
        retriable: false,
        httpStatus: 401,
      }),
    ).toBe('[error] provider-authentication origin=provider http=401 401 unauthorized');
  });

  it('normalizes a legacy message-only error event', () => {
    expect(formatCliAgentErrorEvent({ message: 'fetch failed' })).toBe(
      '\n[error] unknown-agent-failure origin=runtime fetch failed\n',
    );
  });
});
