import { describe, expect, it } from 'vitest';
import type { HostCommand } from '@piwin/contracts';
import { abortSideChatRun, endSideChatSession } from './side-chat-host-requests.js';

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

describe('endSideChatSession', () => {
  it('aborts the foreground run, then archives the side chat', async () => {
    const calls: Array<{ type: string; runId?: string }> = [];
    const request = async (command: { type: string; runId?: string }) => {
      calls.push(command);
      if (command.type === 'session/foreground-run') {
        return { type: 'response' as const, command: command.type, success: true as const, data: { run: { runId: 'r1' } } };
      }
      return { type: 'response' as const, command: command.type, success: true as const, data: {} };
    };
    const response = await endSideChatSession({
      request: request as never,
      sessionId: 'side-1',
      createIdempotencyKey: () => 'k',
    });
    expect(response.success).toBe(true);
    expect(calls.map((call) => call.type)).toEqual([
      'session/foreground-run',
      'session/abort',
      'session/archive',
    ]);
    expect(calls[1]?.runId).toBe('r1');
  });

  it('still archives when there is no run or the abort throws', async () => {
    const calls: string[] = [];
    const request = async (command: { type: string }) => {
      calls.push(command.type);
      if (command.type === 'session/foreground-run') throw new Error('offline');
      return { type: 'response' as const, command: command.type, success: true as const, data: {} };
    };
    await endSideChatSession({ request: request as never, sessionId: 'side-1', createIdempotencyKey: () => 'k' });
    expect(calls).toEqual(['session/foreground-run', 'session/archive']);
  });
});
