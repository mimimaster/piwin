import { describe, expect, it } from 'vitest';
import {
  HOST_COMMAND_REQUEST_ENVELOPE_VERSION,
  isHostCommandRequestEnvelope,
  parseHostCommandRequest,
} from './host-command-request.js';

describe('HostCommandRequest envelope', () => {
  const prompt = {
    type: 'session/prompt' as const,
    sessionId: 's1',
    input: { text: 'hi' },
    foreground: { kind: 'if-idle' as const },
  };

  it('parses a versioned envelope without dropping identity fields', () => {
    const parsed = parseHostCommandRequest({
      v: HOST_COMMAND_REQUEST_ENVELOPE_VERSION,
      command: prompt,
      idempotencyKey: 'gesture-1',
      clientPrincipalId: 'desktop-install-1',
    });
    expect(parsed).toEqual({
      command: prompt,
      idempotencyKey: 'gesture-1',
      clientPrincipalId: 'desktop-install-1',
    });
    expect(
      isHostCommandRequestEnvelope({
        v: 1,
        command: prompt,
        idempotencyKey: 'gesture-1',
      }),
    ).toBe(true);
  });

  it('parses a bare HostCommand as a request without minting a key', () => {
    const parsed = parseHostCommandRequest({ type: 'host/ping' });
    expect(parsed).toEqual({ command: { type: 'host/ping' } });
  });

  it('does not invent an idempotency key for a bare mutation line', () => {
    const parsed = parseHostCommandRequest(prompt);
    expect(parsed).toEqual({ command: prompt });
  });
});
