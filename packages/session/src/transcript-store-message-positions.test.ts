import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SESSION_TRANSCRIPT_PAGE_MAX_LOCATE_IDS } from '@piwin/contracts';
import { openSessionTranscriptStore, type SessionTranscriptStore } from './transcript-store.js';

const roots: string[] = [];
const stores: SessionTranscriptStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function openStore(): Promise<SessionTranscriptStore> {
  const root = await mkdtemp(join(tmpdir(), 'piwin-message-positions-'));
  roots.push(root);
  const store = await openSessionTranscriptStore({
    dbPath: join(root, 'transcript.sqlite3'),
    sessionId: 's1',
    projectPath: '/tmp/project',
  });
  stores.push(store);
  return store;
}
async function append(
  store: SessionTranscriptStore,
  id: string,
  role: 'user' | 'assistant',
): Promise<void> {
  await store.appendMessage({
    id,
    role,
    text: id,
    runtimeGenerationId: 'gen-a',
    backendMessageId: id,
    status: 'done',
    createdAt: '2026-11-08T00:00:00.000Z',
  });
}
const query = { sessionId: 's1', limit: 1, maximumBytes: 16 * 1024 };

describe('transcript resident message positions', () => {
  it('locates rows outside a bounded tail without adding their bodies', async () => {
    const store = await openStore();
    await append(store, 'u1', 'user');
    await append(store, 'a1', 'assistant');
    await append(store, 'a2', 'assistant');
    const result = await store.transcriptPage({
      ...query,
      locateMessageIds: ['a1', 'u1', 'missing', 'u1'],
    });
    expect(result.status).toBe('page');
    if (result.status !== 'page') throw new Error('Expected transcript page');
    expect(result.messages.map((message) => message.id)).toEqual(['a2']);
    expect(result.page).toMatchObject({
      startIndex: 2,
      endIndex: 3,
      messagePositions: [
        { messageId: 'u1', index: 0 },
        { messageId: 'a1', index: 1 },
      ],
    });
    expect(await store.transcriptPage(query)).not.toHaveProperty('page.messagePositions');
  });

  it('uses active-path positions, excluding stored response siblings', async () => {
    const store = await openStore();
    await append(store, 'u1', 'user');
    await append(store, 'old-answer', 'assistant');
    await store.rebaseActiveLeaf('u1');
    await append(store, 'new-answer', 'assistant');
    const result = await store.transcriptPage({
      ...query,
      locateMessageIds: ['old-answer', 'new-answer', 'u1'],
    });
    if (result.status !== 'page') throw new Error('Expected transcript page');
    expect(result.page.messagePositions).toEqual([
      { messageId: 'u1', index: 0 },
      { messageId: 'new-answer', index: 1 },
    ]);
  });

  it('rejects oversized or invalid location requests and accepts an empty request', async () => {
    const store = await openStore();
    for (const locateMessageIds of [
      Array.from(
        { length: SESSION_TRANSCRIPT_PAGE_MAX_LOCATE_IDS + 1 },
        (_, index) => `m-${index}`,
      ),
      [''],
      [' '.repeat(2)],
      ['x'.repeat(257)],
    ]) {
      await expect(store.transcriptPage({ ...query, locateMessageIds })).rejects.toThrow(
        RangeError,
      );
    }
    const result = await store.transcriptPage({ ...query, locateMessageIds: [] });
    expect(result).toMatchObject({ status: 'page', page: { messagePositions: [] } });
  });
});
