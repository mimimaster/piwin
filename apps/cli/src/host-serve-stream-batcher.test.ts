import { describe, expect, it } from 'vitest';
import type { HostPush } from '@piwin/contracts';
import { createHostServeStreamBatcher } from './host-serve-stream-batcher.js';

describe('HostServeStreamBatcher', () => {
  it('reconstructs exact text while coalescing contiguous deltas', async () => {
    const written: HostPush[] = [];
    const batcher = createHostServeStreamBatcher({
      flushIntervalMs: 10_000,
      write: async (message) => {
        written.push(message);
      },
    });

    for (const delta of ['hel', 'lo ', 'world']) {
      batcher.push({
        type: 'event',
        sessionId: 'session-1',
        event: { type: 'message/text_delta', messageId: 'message-1', delta },
      });
    }
    await batcher.flush();

    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      type: 'event',
      event: { type: 'message/text_delta', delta: 'hello world' },
    });
  });

  it('preserves interleaved stream order before lifecycle events', async () => {
    const written: HostPush[] = [];
    const batcher = createHostServeStreamBatcher({
      flushIntervalMs: 10_000,
      write: async (message) => {
        written.push(message);
      },
    });

    batcher.push({
      type: 'event',
      sessionId: 'session-1',
      event: { type: 'message/text_delta', messageId: 'message-1', delta: 'A1' },
    });
    batcher.push({
      type: 'event',
      sessionId: 'session-1',
      event: { type: 'message/text_delta', messageId: 'message-2', delta: 'B1' },
    });
    batcher.push({
      type: 'event',
      sessionId: 'session-1',
      event: { type: 'message/text_delta', messageId: 'message-1', delta: 'A2' },
    });
    batcher.push({
      type: 'event',
      sessionId: 'session-1',
      event: { type: 'message/end', messageId: 'message-1' },
    });
    await batcher.flush();

    expect(written).toHaveLength(4);
    expect(written).toMatchObject([
      { event: { type: 'message/text_delta', messageId: 'message-1', delta: 'A1' } },
      { event: { type: 'message/text_delta', messageId: 'message-2', delta: 'B1' } },
      { event: { type: 'message/text_delta', messageId: 'message-1', delta: 'A2' } },
      { event: { type: 'message/end', messageId: 'message-1' } },
    ]);
  });

  it('bounds oversized pending deltas at the configured UTF-8 limit', async () => {
    const written: HostPush[] = [];
    const batcher = createHostServeStreamBatcher({
      flushIntervalMs: 10_000,
      maxPendingDeltaBytes: 4,
      write: async (message) => {
        written.push(message);
      },
    });

    batcher.push({
      type: 'event',
      sessionId: 'session-1',
      event: { type: 'message/text_delta', messageId: 'message-1', delta: 'abcdef' },
    });
    await batcher.flush();

    expect(written[0]).toMatchObject({
      event: { type: 'message/text_delta', delta: 'abcd' },
    });
  });

  it('retains control events while dropping oldest stream backlog under pressure', async () => {
    const written: HostPush[] = [];
    let releaseFirstWrite: (() => void) | undefined;
    const firstWriteBlocked = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const batcher = createHostServeStreamBatcher({
      flushIntervalMs: 10_000,
      maxWriteBacklogEvents: 2,
      maxWriteBacklogBytes: 100,
      write: async (message) => {
        if (written.length === 0) {
          await firstWriteBlocked;
        }
        written.push(message);
      },
    });

    for (const messageId of ['message-1', 'message-2', 'message-3', 'message-4']) {
      batcher.push({
        type: 'event',
        sessionId: 'session-1',
        event: { type: 'message/text_delta', messageId, delta: messageId },
      });
    }
    batcher.push({
      type: 'permission/request',
      sessionId: 'session-1',
      requestId: 'request-1',
      action: 'bash',
      detail: 'run command',
      defaultDecision: 'deny',
    });
    batcher.push({
      type: 'event',
      sessionId: 'session-1',
      event: { type: 'error', message: 'stream failed' },
    });
    batcher.push({
      type: 'event',
      sessionId: 'session-1',
      event: { type: 'message/end', messageId: 'message-4' },
    });
    batcher.push({
      type: 'run/terminal',
      run: {
        runId: 'run-1',
        kind: 'session-turn',
        status: 'completed',
        rootRunId: 'run-1',
        sessionId: 'session-1',
      },
    });

    releaseFirstWrite?.();
    await batcher.flush();

    expect(written.at(-1)).toMatchObject({ type: 'run/terminal', run: { runId: 'run-1' } });
    expect(written.filter((message) => message.type === 'event')).toContainEqual(
      expect.objectContaining({ event: { type: 'message/end', messageId: 'message-4' } }),
    );
    expect(written).toContainEqual(
      expect.objectContaining({ type: 'permission/request', requestId: 'request-1' }),
    );
    expect(written).toContainEqual(
      expect.objectContaining({ event: { type: 'error', message: 'stream failed' } }),
    );
    expect(written.length).toBeLessThan(8);
  });
});
