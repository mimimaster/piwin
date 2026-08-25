import { describe, expect, it } from 'vitest';
import type { HostCommand } from '@piwin/contracts';
import { abortSideChatRun, sendSideChatPrompt } from './side-chat-host-requests.js';

describe('sendSideChatPrompt', () => {
  it('forwards a caller-owned key and if-idle foreground', async () => {
    const sent: Array<{ command: HostCommand; key?: string }> = [];
    const response = await sendSideChatPrompt({
      request: async (command, options) => {
        sent.push({
          command,
          ...(options?.idempotencyKey === undefined ? {} : { key: options.idempotencyKey }),
        });
        return { type: 'response', command: command.type, success: true, data: { runId: 'run-1' } };
      },
      sessionId: 'side-1',
      text: 'hello',
      createIdempotencyKey: () => 'gesture-side-1',
    });
    expect(response.success).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.command).toMatchObject({
      type: 'session/prompt',
      sessionId: 'side-1',
      input: { text: 'hello' },
      foreground: { kind: 'if-idle' },
    });
    expect(sent[0]?.key).toBe('gesture-side-1');
  });
});

describe('abortSideChatRun', () => {
  it('sends session/abort with the exact runId and a key', async () => {
    const sent: Array<{ command: HostCommand; key?: string }> = [];
    const response = await abortSideChatRun({
      request: async (command, options) => {
        sent.push({
          command,
          ...(options?.idempotencyKey === undefined ? {} : { key: options.idempotencyKey }),
        });
        return { type: 'response', command: command.type, success: true };
      },
      sessionId: 'side-1',
      runId: 'run-live',
      createIdempotencyKey: () => 'abort-1',
    });
    expect(response?.success).toBe(true);
    expect(sent).toEqual([
      {
        command: { type: 'session/abort', sessionId: 'side-1', runId: 'run-live' },
        key: 'abort-1',
      },
    ]);
  });

  it('does not abort when the runId is unknown', async () => {
    let called = false;
    const response = await abortSideChatRun({
      request: async () => {
        called = true;
        return { type: 'response', command: 'session/abort', success: true };
      },
      sessionId: 'side-1',
      runId: null,
      createIdempotencyKey: () => 'abort-1',
    });
    expect(response).toBeUndefined();
    expect(called).toBe(false);
  });
});
