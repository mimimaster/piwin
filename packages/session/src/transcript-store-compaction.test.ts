import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openSessionTranscriptStore, type SessionTranscriptStore } from './transcript-store.js';

async function openStore(label: string): Promise<SessionTranscriptStore> {
  const root = await mkdtemp(join(tmpdir(), `piwin-compaction-store-${label}-`));
  return openSessionTranscriptStore({
    dbPath: join(root, 'transcript.sqlite3'),
    sessionId: `session-${label}`,
    projectPath: '/project',
  });
}

async function appendMessage(
  store: SessionTranscriptStore,
  id: string,
  role: 'user' | 'assistant',
): Promise<void> {
  const result = await store.appendMessage({
    id,
    runtimeGenerationId: 'generation-1',
    backendMessageId: `backend-${id}`,
    role,
    text: id,
    status: 'done',
    createdAt: `2026-09-01T00:00:0${id.length}.000Z`,
  });
  expect(result.ok).toBe(true);
}

describe('transcript compaction boundaries', () => {
  it('stores and reads the newest boundary on the active path', async () => {
    const store = await openStore('roundtrip');
    await appendMessage(store, 'u1', 'user');
    await appendMessage(store, 'a1', 'assistant');
    await store.recordCompaction({
      compactionId: 'compact-1',
      anchorMessageId: 'a1',
      summary: 'Keep the selected implementation and its tests.',
      firstKeptEntryId: 'pi-entry-4',
      tokensBefore: 90_000,
      tokensAfter: 4_000,
      runtimeGenerationId: 'generation-1',
      createdAt: '2026-09-01T00:01:00.000Z',
    });

    await expect(store.readLatestCompaction()).resolves.toMatchObject({
      compactionId: 'compact-1',
      sessionId: 'session-roundtrip',
      anchorMessageId: 'a1',
      summary: 'Keep the selected implementation and its tests.',
      firstKeptEntryId: 'pi-entry-4',
      tokensBefore: 90_000,
      tokensAfter: 4_000,
    });
    store.close();
  });

  it('does not return a boundary whose anchor is on an abandoned branch', async () => {
    const store = await openStore('active-path');
    await appendMessage(store, 'u1', 'user');
    await appendMessage(store, 'a1', 'assistant');
    await appendMessage(store, 'u2', 'user');
    await store.recordCompaction({
      compactionId: 'compact-abandoned',
      anchorMessageId: 'u2',
      summary: 'abandoned summary',
      createdAt: '2026-09-01T00:02:00.000Z',
    });
    await store.rebaseActiveLeaf('a1');
    await appendMessage(store, 'u2-alt', 'user');

    await expect(store.readLatestCompaction()).resolves.toBeUndefined();
    store.close();
  });

  it('deduplicates the explicit command and recorder observing one result', async () => {
    const store = await openStore('dedupe');
    await appendMessage(store, 'a1', 'assistant');
    const input = {
      anchorMessageId: 'a1',
      summary: 'same summary',
      tokensBefore: 10,
      tokensAfter: 3,
      createdAt: '2026-09-01T00:03:00.000Z',
    };
    await store.recordCompaction({ compactionId: 'explicit', ...input });
    await store.recordCompaction({ compactionId: 'event', ...input });

    await expect(store.readLatestCompaction()).resolves.toMatchObject({
      compactionId: 'explicit',
    });
    store.close();
  });

  it('merges optional evidence when the command and recorder disagree on fields', async () => {
    const store = await openStore('dedupe-partial');
    await appendMessage(store, 'a1', 'assistant');
    await store.recordCompaction({
      compactionId: 'explicit-partial',
      anchorMessageId: 'a1',
      summary: 'same summary',
      tokensBefore: 10,
      createdAt: '2026-09-01T00:03:00.000Z',
    });
    await store.recordCompaction({
      compactionId: 'event-partial',
      anchorMessageId: 'a1',
      summary: 'same summary',
      firstKeptEntryId: 'entry-3',
      tokensAfter: 3,
      runtimeGenerationId: 'generation-1',
      createdAt: '2026-09-01T00:03:00.001Z',
    });

    await expect(store.readLatestCompaction()).resolves.toMatchObject({
      compactionId: 'explicit-partial',
      firstKeptEntryId: 'entry-3',
      tokensBefore: 10,
      tokensAfter: 3,
      runtimeGenerationId: 'generation-1',
    });
    store.close();
  });
});
