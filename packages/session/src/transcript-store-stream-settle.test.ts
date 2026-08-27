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
});
