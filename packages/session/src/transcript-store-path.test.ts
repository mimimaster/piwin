import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  openSessionTranscriptStore,
  type SessionTranscriptStore,
} from './transcript-store.js';
import {
  countPathIndexedUserMessages,
  countPathRows,
  countPathRowsBeforeSequence,
} from './transcript-store-path.js';

async function openStore(label: string): Promise<{
  store: SessionTranscriptStore;
  dbPath: string;
  sessionId: string;
}> {
  const rootDir = await mkdtemp(join(tmpdir(), `piwin-path-${label}-`));
  const dbPath = join(rootDir, 'transcript.sqlite3');
  const sessionId = `session-${label}`;
  const store = await openSessionTranscriptStore({
    dbPath,
    sessionId,
    projectPath: '/tmp/project',
  });
  return { store, dbPath, sessionId };
}

async function appendLinear(
  store: SessionTranscriptStore,
  rows: Array<{ id: string; role: 'user' | 'assistant'; text: string }>,
): Promise<void> {
  for (const row of rows) {
    await store.appendMessage({
      id: row.id,
      runtimeGenerationId: 'gen-a',
      backendMessageId: `b-${row.id}`,
      role: row.role,
      text: row.text,
      status: 'done',
      createdAt: '2026-08-21T00:00:00.000Z',
    });
  }
}

/**
 * Task 3 delivers branch writes through the store API; until then the tests
 * split a branch with raw SQL: insert a sibling row and repoint the leaf.
 */
function rawBranch(
  dbPath: string,
  sessionId: string,
  action: { insertSibling?: { id: string; parentId: string; role: string; text: string }; setLeaf: string },
): void {
  const db = new DatabaseSync(dbPath);
  try {
    if (action.insertSibling !== undefined) {
      db.prepare(
        `INSERT INTO transcript_message(
           id, runtime_generation_id, backend_message_id, role, text, status,
           created_at, parent_message_id
         ) VALUES (?, 'gen-branch', ?, ?, ?, 'done', '2026-08-21T00:00:01.000Z', ?)`,
      ).run(
        action.insertSibling.id,
        `b-${action.insertSibling.id}`,
        action.insertSibling.role,
        action.insertSibling.text,
        action.insertSibling.parentId,
      );
    }
    db.prepare(
      'UPDATE transcript_meta SET active_leaf_message_id = ? WHERE session_id = ?',
    ).run(action.setLeaf, sessionId);
  } finally {
    db.close();
  }
}

const LINEAR_ROWS = [
  { id: 'u1', role: 'user' as const, text: 'first question' },
  { id: 'a1', role: 'assistant' as const, text: 'first answer' },
  { id: 'u2', role: 'user' as const, text: 'second question' },
  { id: 'a2', role: 'assistant' as const, text: 'second answer' },
  { id: 'u3', role: 'user' as const, text: 'third question' },
];

describe('active path counts', () => {
  it('covers the whole table for a linear session', async () => {
    const { store, dbPath, sessionId } = await openStore('counts-linear');
    await appendLinear(store, LINEAR_ROWS);
    store.close();
    const db = new DatabaseSync(dbPath);
    try {
      expect(countPathRows(db, sessionId)).toBe(5);
      expect(countPathIndexedUserMessages(db, sessionId)).toBe(3);
      expect(countPathRowsBeforeSequence(db, sessionId, 3)).toBe(2);
    } finally {
      db.close();
    }
  });

  it('counts only the active branch after the leaf moves', async () => {
    const { store, dbPath, sessionId } = await openStore('counts-branch');
    await appendLinear(store, LINEAR_ROWS);
    store.close();
    rawBranch(dbPath, sessionId, {
      insertSibling: { id: 'a1-alt', parentId: 'u1', role: 'assistant', text: 'alternate answer' },
      setLeaf: 'a1-alt',
    });
    const db = new DatabaseSync(dbPath);
    try {
      expect(countPathRows(db, sessionId)).toBe(2);
      expect(countPathIndexedUserMessages(db, sessionId)).toBe(1);
    } finally {
      db.close();
    }
  });

  it('returns zero for an empty store (NULL leaf)', async () => {
    const { store, dbPath, sessionId } = await openStore('counts-empty');
    store.close();
    const db = new DatabaseSync(dbPath);
    try {
      expect(countPathRows(db, sessionId)).toBe(0);
    } finally {
      db.close();
    }
  });
});

describe('path-scoped store reads', () => {
  async function openBranched(label: string): Promise<{
    store: SessionTranscriptStore;
    dbPath: string;
    sessionId: string;
  }> {
    const opened = await openStore(label);
    await appendLinear(opened.store, LINEAR_ROWS);
    opened.store.close();
    rawBranch(opened.dbPath, opened.sessionId, {
      insertSibling: { id: 'a1-alt', parentId: 'u1', role: 'assistant', text: 'alternate answer' },
      setLeaf: 'a1-alt',
    });
    const store = await openSessionTranscriptStore({
      dbPath: opened.dbPath,
      sessionId: opened.sessionId,
      projectPath: '/tmp/project',
    });
    return { store, dbPath: opened.dbPath, sessionId: opened.sessionId };
  }

  it('listTail and count follow the active branch only', async () => {
    const { store } = await openBranched('reads-tail');
    const tail = await store.listTail(10);
    expect(tail.map((message) => message.id)).toEqual(['u1', 'a1-alt']);
    expect(await store.count()).toBe(2);
    store.close();
  });

  it('role lookups and search ignore off-path rows', async () => {
    const { store } = await openBranched('reads-roles');
    expect((await store.firstMessageByRole('assistant'))?.id).toBe('a1-alt');
    expect((await store.lastMessageByRole('user'))?.id).toBe('u1');
    expect(await store.searchMessage('second question')).toBeUndefined();
    expect((await store.searchMessage('alternate'))?.id).toBe('a1-alt');
    store.close();
  });

  it('transcriptPage totals and pagination stay within the branch', async () => {
    const { store, sessionId } = await openBranched('reads-page');
    const page = await store.transcriptPage({
      sessionId,
      limit: 10,
      maximumBytes: 65_536,
    });
    expect(page.status).toBe('page');
    if (page.status === 'page') {
      expect(page.messages.map((message) => message.id)).toEqual(['u1', 'a1-alt']);
      expect(page.page.totalCount).toBe(2);
      expect(page.page.olderCursor).toBeUndefined();
    }
    store.close();
  });

  it('userMessageIndex counts only on-path user rows', async () => {
    const { store, sessionId } = await openBranched('reads-index');
    const index = await store.userMessageIndex({ sessionId, maximumTicks: 50 });
    expect(index.totalUserMessages).toBe(1);
    expect(index.anchors.map((anchor) => anchor.messageId)).toEqual(['u1']);
    store.close();
  });

  it('transcriptWindow refuses off-path anchors', async () => {
    const { store, sessionId } = await openBranched('reads-window');
    const offPath = await store.transcriptWindow({
      sessionId,
      anchorMessageId: 'u2',
      beforeItems: 2,
      afterItems: 2,
      maximumBytes: 65_536,
    });
    expect(offPath.status).toBe('not-found');
    const onPath = await store.transcriptWindow({
      sessionId,
      anchorMessageId: 'u1',
      beforeItems: 2,
      afterItems: 2,
      maximumBytes: 65_536,
    });
    expect(onPath.status).toBe('window');
    if (onPath.status === 'window') {
      expect(onPath.messages.map((message) => message.id)).toEqual(['u1', 'a1-alt']);
    }
    store.close();
  });

  it('history window, recentModel, and outline follow the branch', async () => {
    const { store, sessionId } = await openBranched('reads-history');
    const history = await store.buildHistoryWindow({ maxMessages: 10, maxChars: 10_000 });
    expect(history.map((entry) => entry.text)).toEqual(['first question', 'alternate answer']);
    const outline = await store.outlinePage({ sessionId, limit: 10 });
    expect(outline.nodes.map((node) => node.id)).toEqual(['u1', 'a1-alt']);
    expect(outline.hasOlder).toBe(false);
    store.close();
  });

  it('getMessage still resolves off-path rows by id (deliberately global)', async () => {
    const { store } = await openBranched('reads-get');
    expect((await store.getMessage('u2'))?.text).toBe('second question');
    store.close();
  });

  it('switching the leaf back restores the original branch view', async () => {
    const { store, dbPath, sessionId } = await openBranched('reads-switch-back');
    store.close();
    rawBranch(dbPath, sessionId, { setLeaf: 'u3' });
    const reopened = await openSessionTranscriptStore({
      dbPath,
      sessionId,
      projectPath: '/tmp/project',
    });
    const tail = await reopened.listTail(10);
    expect(tail.map((message) => message.id)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3']);
    expect(await reopened.count()).toBe(5);
    reopened.close();
  });

  it('deleteMessage reparents children and falls the leaf back to the parent', async () => {
    const { store, dbPath, sessionId } = await openStore('reads-delete');
    await appendLinear(store, LINEAR_ROWS);
    // Delete a mid-path row: children reattach to the grandparent.
    expect(await store.deleteMessage('u2')).toBe(true);
    expect((await store.listTail(10)).map((message) => message.id)).toEqual([
      'u1',
      'a1',
      'a2',
      'u3',
    ]);
    // Delete the current leaf: the leaf falls back to its parent.
    expect(await store.deleteMessage('u3')).toBe(true);
    expect((await store.listTail(10)).map((message) => message.id)).toEqual(['u1', 'a1', 'a2']);
    store.close();
    const db = new DatabaseSync(dbPath);
    try {
      const meta = db
        .prepare('SELECT active_leaf_message_id FROM transcript_meta WHERE session_id = ?')
        .get(sessionId) as { active_leaf_message_id: string | null };
      expect(meta.active_leaf_message_id).toBe('a2');
    } finally {
      db.close();
    }
  });
});
