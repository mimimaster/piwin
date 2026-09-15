import { describe, expect, it } from 'vitest';
import {
  agentFailureFromPiEvent,
  agentFailureFromPiFacts,
  agentFailureOriginForCode,
  readHttpStatusFromMessage,
} from './pi-agent-failure.js';

describe('pi-agent-failure', () => {
  it('prefers HTTP status over prose', () => {
    expect(
      agentFailureFromPiFacts({
        errorMessage: 'rate limit mentioned in passing',
        httpStatus: 401,
      }),
    ).toMatchObject({
      code: 'provider-authentication',
      origin: 'provider',
      retriable: false,
      httpStatus: 401,
    });
  });

  it('maps missing finish from the known Pi protocol identity', () => {
    expect(
      agentFailureFromPiFacts({ errorMessage: 'Stream ended without finish_reason' }),
    ).toMatchObject({
      code: 'model-stream-missing-finish',
      origin: 'protocol',
      retriable: true,
    });
  });

  it('maps 401 authentication prose when no status field is present', () => {
    expect(readHttpStatusFromMessage('401: Invalid Authentication')).toBe(401);
    expect(agentFailureFromPiEvent({ errorMessage: '401: Invalid Authentication' })).toMatchObject({
      code: 'provider-authentication',
      origin: 'provider',
      httpStatus: 401,
      retriable: false,
    });
  });

  it('classifies Anthropic extra-usage 400 as quota before generic HTTP mapping', () => {
    expect(
      agentFailureFromPiFacts({
        errorMessage:
          '400 {"type":"error","error":{"type":"invalid_request_error","message":"Third-party apps now draw from your extra usage, not your plan limits. Add more at claude.ai/settings/usage and keep going."}}',
        httpStatus: 400,
      }),
    ).toMatchObject({
      code: 'provider-quota',
      origin: 'provider',
      retriable: false,
      httpStatus: 400,
    });
    expect(
      agentFailureFromPiFacts({
        errorMessage: "You're out of extra usage. Add more at claude.ai/settings/usage and keep going.",
      }).message,
    ).toContain('claude.ai/settings/usage');
  });

  it('maps rate limit, quota, context, and timeout fallbacks last', () => {
    expect(agentFailureFromPiFacts({ errorMessage: 'Too many requests' }).code).toBe(
      'provider-rate-limit',
    );
    expect(agentFailureFromPiFacts({ errorMessage: 'insufficient quota' }).code).toBe(
      'provider-quota',
    );
    expect(agentFailureFromPiFacts({ errorMessage: 'maximum context length' }).code).toBe(
      'context-limit-exceeded',
    );
    expect(agentFailureFromPiFacts({ errorMessage: 'deadline exceeded' }).code).toBe(
      'model-request-timeout',
    );
  });

  it('does not invent a specific code from unknown prose', () => {
    expect(agentFailureFromPiFacts({ errorMessage: 'something went sideways' })).toMatchObject({
      code: 'unknown-agent-failure',
      origin: 'runtime',
      retriable: false,
    });
  });

  it('maps Connection error and transport natives to provider-unavailable', () => {
    expect(agentFailureFromPiFacts({ errorMessage: 'Connection error.' })).toMatchObject({
      code: 'provider-unavailable',
      origin: 'provider',
      retriable: true,
      message: 'Connection error.',
    });
    expect(
      agentFailureFromPiFacts({
        errorMessage: 'Connection error.',
        nativeName: 'APIConnectionError',
        provider: 'custom-openai',
        baseUrl: 'http://127.0.0.1:8317/v1',
      }),
    ).toMatchObject({
      code: 'provider-unavailable',
      nativeName: 'APIConnectionError',
      message: 'Connection error (custom-openai · http://127.0.0.1:8317/v1)',
      retriable: true,
    });
    expect(
      agentFailureFromPiFacts({ errorMessage: 'fetch failed: ECONNREFUSED' }),
    ).toMatchObject({
      code: 'provider-unavailable',
      retriable: true,
    });
  });

  it('reads provider context from Pi assistant error payloads', () => {
    expect(
      agentFailureFromPiEvent({
        role: 'assistant',
        provider: 'custom-openai',
        model: 'gemini-3.7-flash-high',
        stopReason: 'error',
        errorMessage: 'Connection error.',
      }),
    ).toMatchObject({
      code: 'provider-unavailable',
      message: 'Connection error (custom-openai)',
      retriable: true,
    });
  });

  it('redacts secrets in the bounded message', () => {
    const failure = agentFailureFromPiFacts({
      errorMessage: 'Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz',
    });
    expect(failure.message).not.toMatch(/sk-/);
    expect(failure.message).toContain('[redacted]');
  });

  it('keeps origin aligned with the structured code', () => {
    expect(agentFailureOriginForCode('provider-authentication')).toBe('provider');
    expect(agentFailureOriginForCode('model-stream-stalled')).toBe('transport');
    expect(agentFailureOriginForCode('model-stream-missing-finish')).toBe('protocol');
    expect(agentFailureOriginForCode('backend-worker-crash')).toBe('runtime');
  });
});
