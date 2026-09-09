import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openSessionTranscriptStore } from './transcript-store.js';

async function openStore(label: string) {
  const rootDir = await mkdtemp(join(tmpdir(), `piwin-settle-${label}-`));
  const store = await openSessionTranscriptStore({
    dbPath: join(rootDir, 'transcript.sqlite3'),
    sessionId: `session-${label}`,
    projectPath: '/tmp/project',
  });
  return store;
}

describe('SessionTranscriptStore.settleStreamingMessages', () => {
  it('closes orphan assistant streams and records thinking end metadata', async () => {
    const store = await openStore('orphan');
    await store.appendMessage({
      id: 'user-1',
      runtimeGenerationId: 'gen-1',
      backendMessageId: 'u1',
      role: 'user',
      text: 'draw svg',
      status: 'done',
      createdAt: '2026-08-27T03:25:34.000Z',
    });
    await store.appendMessage({
      id: 'assistant-1',
      runtimeGenerationId: 'gen-1',
      backendMessageId: 'a1',
      role: 'assistant',
      text: '',
      thinking: '<svg opacity="0.',
      status: 'streaming',
      runId: 'run-1',
      createdAt: '2026-08-27T03:25:58.000Z',
      metadata: { thinkingStartedAt: '2026-08-27T03:25:58.000Z' },
    });
    await store.appendMessage({
      id: 'assistant-done',
      runtimeGenerationId: 'gen-1',
      backendMessageId: 'a0',
      role: 'assistant',
      text: 'earlier',
      status: 'done',
      runId: 'run-0',
      createdAt: '2026-08-27T03:25:37.000Z',
    });

    const settled = await store.settleStreamingMessages({
      updatedAt: '2026-08-27T03:40:00.000Z',
      outcome: 'cancelled',
      terminalMessage: 'The previous run was interrupted before this response finished.',
    });

    expect(settled.map((message) => message.id)).toEqual(['assistant-1']);
    const repaired = await store.getMessage('assistant-1');
    expect(repaired?.status).toBe('done');
    expect(repaired?.thinking).toBe('<svg opacity="0.');
    expect(repaired?.outcome).toBe('cancelled');
    expect(repaired?.terminalMessage).toBe(
      'The previous run was interrupted before this response finished.',
    );
    expect(repaired?.endedAt).toBe('2026-08-27T03:40:00.000Z');
    expect(repaired?.thinkingEndedAt).toBe('2026-08-27T03:40:00.000Z');
    expect((await store.getMessage('assistant-done'))?.status).toBe('done');
    expect((await store.getMessage('assistant-done'))?.outcome).toBeUndefined();
    store.close();
  });

  it('settles only the requested run id', async () => {
    const store = await openStore('by-run');
    await store.appendMessage({
      id: 'a-run-1',
      runtimeGenerationId: 'gen-1',
      backendMessageId: 'a1',
      role: 'assistant',
      text: '',
      status: 'streaming',
      runId: 'run-1',
      createdAt: '2026-08-27T03:25:58.000Z',
    });
    await store.appendMessage({
      id: 'a-run-2',
      runtimeGenerationId: 'gen-1',
      backendMessageId: 'a2',
      role: 'assistant',
      text: '',
      status: 'streaming',
      runId: 'run-2',
      createdAt: '2026-08-27T03:26:58.000Z',
    });

    const settled = await store.settleStreamingMessages({
      runId: 'run-1',
      updatedAt: '2026-08-27T03:41:00.000Z',
      outcome: 'failed',
      terminalMessage: 'Model stream idle timeout.',
    });

    expect(settled.map((message) => message.id)).toEqual(['a-run-1']);
    expect((await store.getMessage('a-run-1'))?.status).toBe('done');
    expect((await store.getMessage('a-run-1'))?.outcome).toBe('failed');
    expect((await store.getMessage('a-run-2'))?.status).toBe('streaming');
    store.close();
  });

  it('persists structured Agent failure on settle', async () => {
    const store = await openStore('failure');
    await store.appendMessage({
      id: 'a-fail',
      runtimeGenerationId: 'gen-1',
      backendMessageId: 'a1',
      role: 'assistant',
      text: '',
      status: 'streaming',
      runId: 'run-fail',
      createdAt: '2026-08-27T03:25:58.000Z',
    });
    const failure = {
      code: 'model-stream-stalled' as const,
      origin: 'transport' as const,
      message: 'parsed stream stalled',
      retriable: true,
    };
    await store.settleStreamingMessages({
      runId: 'run-fail',
      updatedAt: '2026-08-27T03:41:00.000Z',
      outcome: 'failed',
      terminalMessage: failure.message,
      failure,
    });
    expect((await store.getMessage('a-fail'))?.failure).toEqual(failure);
    store.close();
  });

  it('persists a completed length stop reason', async () => {
    const store = await openStore('length');
    await store.appendMessage({
      id: 'a-len',
      runtimeGenerationId: 'gen-1',
      backendMessageId: 'a1',
      role: 'assistant',
      text: '<!DOCTYPE html>',
      status: 'streaming',
      runId: 'run-len',
      createdAt: '2026-08-27T03:25:58.000Z',
    });
    await store.settleStreamingMessages({
      runId: 'run-len',
      updatedAt: '2026-08-27T03:41:00.000Z',
      outcome: 'completed',
      agentStopReason: 'length',
    });
    const message = await store.getMessage('a-len');
    expect(message?.status).toBe('done');
    expect(message?.outcome).toBe('completed');
    expect(message?.agentStopReason).toBe('length');
    store.close();
  });

  it('clears intermediate failure evidence when the Run completes', async () => {
    const store = await openStore('complete-clears-failure');
    await store.appendMessage({
      id: 'a-retry',
      runtimeGenerationId: 'gen-1',
      backendMessageId: 'a1',
      role: 'assistant',
      text: 'recovered',
      status: 'streaming',
      runId: 'run-retry',
      createdAt: '2026-08-27T03:25:58.000Z',
      metadata: {
        failure: {
          code: 'model-stream-missing-finish',
          origin: 'protocol',
          message: 'Stream ended without finish_reason',
          retriable: true,
        },
        terminalMessage: 'Stream ended without finish_reason',
      },
    });
    await store.settleStreamingMessages({
      runId: 'run-retry',
      updatedAt: '2026-08-27T03:41:00.000Z',
      outcome: 'completed',
    });
    const settled = await store.getMessage('a-retry');
    expect(settled?.status).toBe('done');
    expect(settled?.outcome).toBe('completed');
    expect(settled?.failure).toBeUndefined();
    expect(settled?.terminalMessage).toBeUndefined();
    store.close();
  });

  it('is a no-op when no streaming assistant rows exist', async () => {
    const store = await openStore('noop');
    await store.appendMessage({
      id: 'a-done',
      runtimeGenerationId: 'gen-1',
      backendMessageId: 'a1',
      role: 'assistant',
      text: 'ok',
      status: 'done',
      createdAt: '2026-08-27T03:25:37.000Z',
    });
    expect(
      await store.settleStreamingMessages({
        updatedAt: '2026-08-27T03:41:00.000Z',
        outcome: 'cancelled',
      }),
    ).toEqual([]);
    store.close();
  });

  it('stamps outcome on done+failure rows that never stayed streaming', async () => {
    const store = await openStore('done-failure');
    const failure = {
      code: 'provider-unavailable' as const,
      origin: 'provider' as const,
      message: 'Connection error.',
      retriable: true,
    };
    await store.appendMessage({
      id: 'a-done-fail',
      runtimeGenerationId: 'gen-1',
      backendMessageId: 'a1',
      role: 'assistant',
      text: '',
      status: 'done',
      runId: 'run-done-fail',
      createdAt: '2026-08-27T03:25:58.000Z',
      metadata: { failure },
    });
    await store.appendMessage({
      id: 'a-other-run',
      runtimeGenerationId: 'gen-1',
      backendMessageId: 'a2',
      role: 'assistant',
      text: '',
      status: 'done',
      runId: 'run-other',
      createdAt: '2026-08-27T03:26:58.000Z',
      metadata: { failure },
    });

    const settled = await store.settleStreamingMessages({
      runId: 'run-done-fail',
      updatedAt: '2026-08-27T03:42:00.000Z',
      outcome: 'failed',
      terminalMessage: failure.message,
      failure,
    });

    expect(settled.map((message) => message.id)).toEqual(['a-done-fail']);
    const repaired = await store.getMessage('a-done-fail');
    expect(repaired?.status).toBe('done');
    expect(repaired?.outcome).toBe('failed');
    expect(repaired?.endedAt).toBe('2026-08-27T03:42:00.000Z');
    expect(repaired?.failure).toEqual(failure);
    expect((await store.getMessage('a-other-run'))?.outcome).toBeUndefined();
    store.close();
  });

  it('does not re-stamp assistant rows that already carry an outcome', async () => {
    const store = await openStore('already-outcome');
    await store.appendMessage({
      id: 'a-prior',
      runtimeGenerationId: 'gen-1',
      backendMessageId: 'a1',
      role: 'assistant',
      text: 'earlier',
      status: 'done',
      runId: 'run-prior',
      createdAt: '2026-08-27T03:25:58.000Z',
      metadata: {
        outcome: 'completed',
        endedAt: '2026-08-27T03:26:00.000Z',
      },
    });
    expect(
      await store.settleStreamingMessages({
        runId: 'run-prior',
        updatedAt: '2026-08-27T03:42:00.000Z',
        outcome: 'failed',
        terminalMessage: 'late failure',
      }),
    ).toEqual([]);
    const prior = await store.getMessage('a-prior');
    expect(prior?.outcome).toBe('completed');
    expect(prior?.endedAt).toBe('2026-08-27T03:26:00.000Z');
    store.close();
  });
});
