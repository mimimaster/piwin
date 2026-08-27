import { describe, expect, it } from 'vitest';
import {
  AGENT_FAILURE_MESSAGE_MAX_CHARS,
  boundAgentFailureText,
  createUnknownAgentFailure,
  isAgentFailure,
  normalizeAgentErrorEvent,
  normalizeAgentFailure,
  sanitizeAgentFailure,
} from './agent-failure.js';

describe('AgentFailure', () => {
  it('accepts a complete optional-property failure and rejects extra undefined fields', () => {
    const failure = sanitizeAgentFailure({
      code: 'provider-http-error',
      origin: 'provider',
      message: '404: No endpoints available',
      retriable: true,
      httpStatus: 404,
      nativeName: 'ApiError',
    });
    expect(isAgentFailure(failure)).toBe(true);
    expect(failure).toEqual({
      code: 'provider-http-error',
      origin: 'provider',
      message: '404: No endpoints available',
      retriable: true,
      httpStatus: 404,
      nativeName: 'ApiError',
    });
    expect(
      'httpStatus' in
        sanitizeAgentFailure({
          code: 'unknown-agent-failure',
          origin: 'runtime',
          message: 'x',
          retriable: false,
        }),
    ).toBe(false);
  });

  it('redacts secrets and bounds message text', () => {
    const longSecret = `Bearer ${'a'.repeat(80)} ${'x'.repeat(AGENT_FAILURE_MESSAGE_MAX_CHARS)}`;
    const bounded = boundAgentFailureText(longSecret, AGENT_FAILURE_MESSAGE_MAX_CHARS);
    expect(bounded).toContain('[redacted]');
    expect(bounded).not.toContain('Bearer ');
    expect(bounded.length).toBe(AGENT_FAILURE_MESSAGE_MAX_CHARS);
  });

  it('maps legacy frames without failure to unknown-agent-failure', () => {
    expect(normalizeAgentFailure(undefined, 'Stream ended without finish_reason')).toEqual(
      createUnknownAgentFailure('Stream ended without finish_reason'),
    );
    const event = normalizeAgentErrorEvent({
      type: 'error',
      message: 'sk-abc123456789 provider rejected request',
      retriable: false,
    });
    expect(event.failure).toEqual({
      code: 'unknown-agent-failure',
      origin: 'runtime',
      message: expect.stringContaining('[redacted]'),
      retriable: false,
    });
    expect(event.message).not.toContain('sk-');
    expect(event.failure?.code).toBe('unknown-agent-failure');
  });
});
