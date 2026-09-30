import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import { openSessionTranscriptStore } from './transcript-store.js';

it('SQLite pages and seeks share complete totals, invalidate after edits, and exclude inactive branches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piwin-summary-'));
  const store = await openSessionTranscriptStore({
    dbPath: join(root, 'transcript.sqlite3'),
    sessionId: 'summary',
    projectPath: '/tmp/project',
  });
  const messages: SessionTranscriptMessage[] = Array.from({ length: 90 }, (_, index) => ({
    id: `m-${index}`,
    role: index === 0 ? 'user' : 'assistant',
    text: index === 0 ? 'work' : '',
    status: 'done',
    createdAt: new Date(index * 1000).toISOString(),
    ...(index === 0
      ? {}
      : {
          tools: [
            {
              toolCallId: `t-${index}`,
              toolName: 'edit',
              output: '',
              status: 'done' as const,
              presentation: {
                kind: 'filesystem' as const,
                title: 'edit',
                changedPaths: ['same.ts'],
              },
            },
          ],
        }),
  }));
  try {
    await store.importLegacyDocument({
      version: 1,
      sessionId: 'summary',
      projectPath: '/tmp/project',
      messages,
      updatedAt: new Date().toISOString(),
    });
    const query = { sessionId: 'summary', limit: 16, maximumBytes: 256 * 1024 };
    const tail = await store.transcriptPage(query);
    if (tail.status !== 'page' || !tail.page.olderCursor) throw new Error('expected tail');
    const older = await store.transcriptPage({ ...query, beforeCursor: tail.page.olderCursor });
    const seek = await store.transcriptWindow({
      sessionId: 'summary',
      anchorMessageId: 'm-40',
      beforeItems: 2,
      afterItems: 2,
      maximumBytes: query.maximumBytes,
    });
    if (older.status !== 'page' || seek.status !== 'window') throw new Error('expected windows');
    expect(tail.page.turnSummaries).toEqual(older.page.turnSummaries);
    expect(tail.page.turnSummaries).toEqual(seek.window.turnSummaries);
    expect(tail.page.turnSummaries?.[0]).toMatchObject({
      toolCount: 89,
      fileCount: 1,
      endIndex: 90,
    });
    await store.rebaseActiveLeaf('m-40');
    const branch = await store.transcriptPage(query);
    if (branch.status !== 'page') throw new Error('expected branch page');
    expect(branch.page.turnSummaries?.[0]).toMatchObject({ toolCount: 40, endIndex: 41 });
    expect(branch.page.turnSummaries?.[0]?.revision).not.toBe(tail.page.revision);
  } finally {
    await store.close();
  }
});
