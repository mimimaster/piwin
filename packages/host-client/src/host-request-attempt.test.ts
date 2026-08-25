import { describe, expect, it } from 'vitest';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import {
  createHostRequestAttempt,
  executeHostRequestAttempt,
} from './host-request-attempt.js';

describe('HostRequestAttempt', () => {
  const command: HostCommand = {
    type: 'session/prompt',
    sessionId: 's1',
    input: { text: 'hi' },
    foreground: { kind: 'if-idle' },
  };

  it('freezes the gesture key and reuses it on every execute', async () => {
    const attempt = createHostRequestAttempt(command, 'gesture-1');
    const calls: Array<{ command: HostCommand; key?: string }> = [];
    const request = async (
      sent: HostCommand,
      options?: { idempotencyKey?: string },
    ): Promise<HostResponse> => {
      calls.push(
        options?.idempotencyKey === undefined
          ? { command: sent }
          : { command: sent, key: options.idempotencyKey },
      );
      return { type: 'response', command: sent.type, success: true };
    };
    await executeHostRequestAttempt(request, attempt);
    await executeHostRequestAttempt(request, attempt);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.key).toBe('gesture-1');
    expect(calls[1]?.key).toBe('gesture-1');
    expect(calls[0]?.command).toBe(attempt.command);
    expect(calls[1]?.command).toBe(attempt.command);
  });

  it('refuses to construct a required mutation without a key', () => {
    expect(() => createHostRequestAttempt(command, '   ')).toThrow('idempotency-key-required');
  });

  it('does not let callers mutate the frozen command into a different digest', () => {
    const attempt = createHostRequestAttempt(command, 'gesture-1');
    expect(() => {
      (attempt as { idempotencyKey: string }).idempotencyKey = 'other';
    }).toThrow();
    expect(attempt.idempotencyKey).toBe('gesture-1');
  });
});
