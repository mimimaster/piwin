import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import { openSessionTranscriptStore, type SessionTranscriptStore } from './transcript-store.js';

async function openStore(label: string): Promise<SessionTranscriptStore> {
  const root = await mkdtemp(join(tmpdir(), `piwin-turn-marks-${label}-`));
  return openSessionTranscriptStore({
    dbPath: join(root, 'transcript.sqlite3'),
    sessionId: `session-${label}`,
    projectPath: '/project',
  });
}

let clock = 0;
async function append(
  store: SessionTranscriptStore,
  id: string,
  role: 'user' | 'assistant',
  text: string,
  status: SessionTranscriptMessage['status'] = 'done',
): Promise<void> {
  clock += 1;
  const result = await store.appendMessage({
    id,
    runtimeGenerationId: 'generation-1',
    backendMessageId: `backend-${id}`,
    role,
    text,
    status,
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, clock)).toISOString(),
  });
  expect(result.ok).toBe(true);
}

describe('user-message index turn marks', () => {
  it('marks failed, artifact, compaction and branch turns on the active path', async () => {
    const store = await openStore('kinds');
    await append(store, 'u0', 'user', 'plain question');
    await append(store, 'a0', 'assistant', 'plain answer');
    await append(store, 'u1', 'user', 'this will fail');
    await append(store, 'a1', 'assistant', 'partial', 'error');
    await append(store, 'u2', 'user', 'draw a chart');
    await append(store, 'a2', 'assistant', 'Here:\n```artifact-html title="Chart"\n<div></div>\n```');
    await append(store, 'u3', 'user', 'keep going');
    await append(store, 'a3', 'assistant', 'long answer');
    await store.recordCompaction({
      compactionId: 'compact-1',
      anchorMessageId: 'a3',
      summary: 'Summary of the first turns.',
      runtimeGenerationId: 'generation-1',
      createdAt: '2026-10-01T00:10:00.000Z',
    });
    await append(store, 'u4', 'user', 'first wording');
    await append(store, 'a4', 'assistant', 'first reply');
    // Rewrite the last prompt: u4 and u4-alt become siblings under a3.
    await store.rebaseActiveLeaf('a3');
    await append(store, 'u4-alt', 'user', 'second wording');

    const index = await store.userMessageIndex({ sessionId: 'session-kinds', maximumTicks: 16 });
    expect(index.anchors.map((anchor) => [anchor.messageId, anchor.marks])).toEqual([
      ['u0', undefined],
      ['u1', ['error']],
      ['u2', ['artifact']],
      ['u3', ['compaction']],
      ['u4-alt', ['branch']],
    ]);
    store.close();
  });

  it('picks up a compaction recorded after the index was read', async () => {
    const store = await openStore('cached');
    await append(store, 'u0', 'user', 'question');
    await append(store, 'a0', 'assistant', 'answer');
    const query = { sessionId: 'session-cached', maximumTicks: 16 };
    expect((await store.userMessageIndex(query)).anchors[0]?.marks).toBeUndefined();
    // Recording a compaction writes no transcript row, so no revision bump.
    await store.recordCompaction({
      compactionId: 'compact-late',
      anchorMessageId: 'a0',
      summary: 'Summary.',
      runtimeGenerationId: 'generation-1',
      createdAt: '2026-10-01T01:00:00.000Z',
    });
    expect((await store.userMessageIndex(query)).anchors[0]?.marks).toEqual(['compaction']);
    store.close();
  });

  it('keeps a marked turn visible inside a sampled span', async () => {
    const store = await openStore('sampled');
    for (let turn = 0; turn < 64; turn += 1) {
      await append(store, `u${turn}`, 'user', `request ${turn}`);
      await append(store, `a${turn}`, 'assistant', `reply ${turn}`, turn === 21 ? 'error' : 'done');
    }
    const index = await store.userMessageIndex({ sessionId: 'session-sampled', maximumTicks: 16 });
    expect(index.mode).toBe('sampled');
    const marked = index.anchors.filter((anchor) => anchor.marks?.includes('error'));
    expect(marked).toHaveLength(1);
    expect(marked[0]?.spanStartOrdinal).toBeLessThanOrEqual(21);
    expect(marked[0]?.spanEndOrdinal).toBeGreaterThanOrEqual(21);
    store.close();
  });
});

describe('transcript page user ordinal start', () => {
  it('places pages and windows among the session user messages', async () => {
    const store = await openStore('ordinal');
    for (let turn = 0; turn < 10; turn += 1) {
      await append(store, `u${turn}`, 'user', `request ${turn}`);
      await append(store, `a${turn}`, 'assistant', `reply ${turn}`);
    }
    const tail = await store.transcriptPage({
      sessionId: 'session-ordinal',
      limit: 4,
      maximumBytes: 64 * 1024,
    });
    if (tail.status !== 'page') throw new Error('expected page');
    // Last four rows: u8 a8 u9 a9.
    expect(tail.page.userOrdinalStart).toBe(8);

    const window = await store.transcriptWindow({
      sessionId: 'session-ordinal',
      anchorMessageId: 'u5',
      beforeItems: 1,
      afterItems: 2,
      maximumBytes: 64 * 1024,
    });
    if (window.status !== 'window') throw new Error('expected window');
    // a4 u5 a5 u6: the first user message in the window is the sixth.
    expect(window.messages.map((message) => message.id)).toEqual(['a4', 'u5', 'a5', 'u6']);
    expect(window.window.userOrdinalStart).toBe(5);
    store.close();
  });
});
