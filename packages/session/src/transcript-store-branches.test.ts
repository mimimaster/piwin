import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectWorkspaceWritesFromMessages } from '@piwin/contracts';
import {
  openSessionTranscriptStore,
  type SessionTranscriptStore,
} from './transcript-store.js';

async function openStore(label: string): Promise<{
  store: SessionTranscriptStore;
  sessionId: string;
}> {
  const rootDir = await mkdtemp(join(tmpdir(), `piwin-branches-${label}-`));
  const sessionId = `session-${label}`;
  const store = await openSessionTranscriptStore({
    dbPath: join(rootDir, 'transcript.sqlite3'),
    sessionId,
    projectPath: '/tmp/project',
  });
  return { store, sessionId };
}

async function append(
  store: SessionTranscriptStore,
  id: string,
  role: 'user' | 'assistant',
  text: string,
): Promise<void> {
  const result = await store.appendMessage({
    id,
    runtimeGenerationId: 'gen-a',
    backendMessageId: `b-${id}`,
    role,
    text,
    status: 'done',
    createdAt: `2026-08-21T00:00:0${id.length}.000Z`,
  });
  expect(result.ok).toBe(true);
}

/** U1 → A1 → U2 → A2 linear conversation. */
async function seedLinear(store: SessionTranscriptStore): Promise<void> {
  await append(store, 'u1', 'user', 'first question');
  await append(store, 'a1', 'assistant', 'first answer');
  await append(store, 'u2', 'user', 'second question');
  await append(store, 'a2', 'assistant', 'second answer');
}

/** Branch at A1: rebase and append the sibling user turn U2'. */
async function branchAtA1(store: SessionTranscriptStore): Promise<void> {
  await store.rebaseActiveLeaf('a1');
  await append(store, 'u2-alt', 'user', 'second question, rewritten');
}

describe('transcript store branches', () => {
  it('tracks the active leaf through appends', async () => {
    const { store } = await openStore('leaf');
    expect(await store.getActiveLeaf()).toBeNull();
    await seedLinear(store);
    expect(await store.getActiveLeaf()).toBe('a2');
    store.close();
  });

  it('rebase + append creates a sibling branch without deleting the old one', async () => {
    const { store } = await openStore('rebase');
    await seedLinear(store);
    await branchAtA1(store);
    expect((await store.listTail(10)).map((message) => message.id)).toEqual([
      'u1',
      'a1',
      'u2-alt',
    ]);
    // The abandoned branch is stored, reachable by id, invisible to path reads.
    expect((await store.getMessage('u2'))?.text).toBe('second question');
    expect((await store.getMessage('a2'))?.text).toBe('second answer');
    expect(await store.count()).toBe(3);
    store.close();
  });

  it('rejects rebasing onto a missing message', async () => {
    const { store } = await openStore('rebase-missing');
    await seedLinear(store);
    await expect(store.rebaseActiveLeaf('nope')).rejects.toThrow(RangeError);
    store.close();
  });

  it('rebase to null starts a new root', async () => {
    const { store } = await openStore('rebase-null');
    await seedLinear(store);
    await store.rebaseActiveLeaf(null);
    await append(store, 'u1-alt', 'user', 'fresh start');
    expect((await store.listTail(10)).map((message) => message.id)).toEqual(['u1-alt']);
    expect((await store.getMessage('u1'))?.id).toBe('u1');
    store.close();
  });

  it('listBranchPoints reports the ‹n/m› data at the fork', async () => {
    const { store } = await openStore('points');
    await seedLinear(store);
    await branchAtA1(store);
    const points = await store.listBranchPoints({ previewChars: 40 });
    expect(points).toHaveLength(1);
    const point = points[0];
    expect(point?.anchorMessageId).toBe('a1');
    expect(point?.siblings.map((sibling) => sibling.headMessageId)).toEqual(['u2', 'u2-alt']);
    expect(point?.activeIndex).toBe(1);
    expect(point?.siblings[0]).toMatchObject({
      headMessageId: 'u2',
      preview: 'second question',
      leafPreview: 'second answer',
      messageCount: 2,
    });
    expect(point?.siblings[1]).toMatchObject({
      headMessageId: 'u2-alt',
      preview: 'second question, rewritten',
      messageCount: 1,
    });
    store.close();
  });

  it('returns no branch points for a linear session', async () => {
    const { store } = await openStore('points-linear');
    await seedLinear(store);
    expect(await store.listBranchPoints({ previewChars: 40 })).toEqual([]);
    store.close();
  });

  it('switchActiveBranch lands on the deepest node of the target subtree', async () => {
    const { store } = await openStore('switch');
    await seedLinear(store);
    await branchAtA1(store);
    const switched = await store.switchActiveBranch('u2');
    expect(switched.activeLeafMessageId).toBe('a2');
    expect((await store.listTail(10)).map((message) => message.id)).toEqual([
      'u1',
      'a1',
      'u2',
      'a2',
    ]);
    const back = await store.switchActiveBranch('u2-alt');
    expect(back.activeLeafMessageId).toBe('u2-alt');
    store.close();
  });

  it('switching branches invalidates open page cursors and the user index revision', async () => {
    const { store, sessionId } = await openStore('switch-stale');
    await seedLinear(store);
    await branchAtA1(store);
    const before = await store.userMessageIndex({ sessionId, maximumTicks: 50 });
    const page = await store.transcriptPage({ sessionId, limit: 1, maximumBytes: 65_536 });
    expect(page.status).toBe('page');
    const cursor = page.status === 'page' ? page.page.olderCursor : undefined;
    expect(cursor).toBeDefined();
    await store.switchActiveBranch('u2');
    const reread = await store.transcriptPage({
      sessionId,
      limit: 1,
      maximumBytes: 65_536,
      ...(cursor === undefined ? {} : { beforeCursor: cursor }),
    });
    expect(reread.status).toBe('stale-cursor');
    const after = await store.userMessageIndex({ sessionId, maximumTicks: 50 });
    expect(after.revision).not.toBe(before.revision);
    store.close();
  });

  it('truncateFrom deletes an off-path subtree without moving the leaf', async () => {
    const { store } = await openStore('truncate-offpath');
    await seedLinear(store);
    await branchAtA1(store);
    // Active branch is u1→a1→u2-alt; delete the abandoned u2 subtree.
    const result = await store.truncateFrom('u2');
    expect(result).toEqual({ found: true, removedCount: 2, remainingCount: 3 });
    expect(await store.getActiveLeaf()).toBe('u2-alt');
    expect(await store.getMessage('u2')).toBeUndefined();
    expect(await store.getMessage('a2')).toBeUndefined();
    expect((await store.listTail(10)).map((message) => message.id)).toEqual([
      'u1',
      'a1',
      'u2-alt',
    ]);
    store.close();
  });

  it('truncateFrom on the active path falls the leaf back to the parent', async () => {
    const { store } = await openStore('truncate-onpath');
    await seedLinear(store);
    await branchAtA1(store);
    const result = await store.truncateFrom('u2-alt');
    expect(result).toEqual({ found: true, removedCount: 1, remainingCount: 2 });
    expect(await store.getActiveLeaf()).toBe('a1');
    expect((await store.listTail(10)).map((message) => message.id)).toEqual(['u1', 'a1']);
    store.close();
  });

  it('truncateFrom cascades native entries for every removed row', async () => {
    const { store } = await openStore('truncate-native');
    await seedLinear(store);
    await store.appendNativeEntries('u2', [
      { ordinal: 0, entry: { format: 'pi-message-v1', payload: 'u2-native', byteLength: 9 } },
    ]);
    await store.appendNativeEntries('a2', [
      { ordinal: 0, entry: { format: 'pi-message-v1', payload: 'a2-native', byteLength: 9 } },
    ]);
    const result = await store.truncateFrom('u2');
    expect(result.removedCount).toBe(2);
    expect(await store.readNativeEntries('u2')).toHaveLength(0);
    expect(await store.readNativeEntries('a2')).toHaveLength(0);
    store.close();
  });

  it('truncateFrom on a missing id reports the current path length', async () => {
    const { store } = await openStore('truncate-missing');
    await seedLinear(store);
    const result = await store.truncateFrom('missing');
    expect(result).toEqual({ found: false, removedCount: 0, remainingCount: 4 });
    store.close();
  });

  it('round-trips workspaceWrites and exposes them as off-path after a fork', async () => {
    const { store } = await openStore('writes');
    await append(store, 'u1', 'user', 'first');
    await append(store, 'a1', 'assistant', 'first answer');
    await append(store, 'u2', 'user', 'second');
    await store.appendMessage({
      id: 'a2',
      runtimeGenerationId: 'gen-a',
      backendMessageId: 'b-a2',
      role: 'assistant',
      text: 'edited a file',
      status: 'done',
      createdAt: '2026-08-21T00:00:04.000Z',
      metadata: { workspaceWrites: { files: ['src/old.ts'], hasUnknownWrites: false } },
    });
    expect((await store.getMessage('a2'))?.workspaceWrites).toEqual({
      files: ['src/old.ts'],
      hasUnknownWrites: false,
    });
    await store.rebaseActiveLeaf('a1');
    await append(store, 'u2-alt', 'user', 'other direction');
    await store.switchActiveBranch('u2');
    const abandoned = await store.listAbandonedAssistantRows('u2-alt');
    expect(abandoned?.map((message) => message.id)).toEqual(['a2']);
    expect(collectWorkspaceWritesFromMessages(abandoned ?? [])).toEqual({
      files: ['src/old.ts'],
      hasUnknownWrites: false,
    });
    // The panel marks only the branch that wrote.
    const points = await store.listBranchPoints({ previewChars: 40 });
    expect(points[0]?.siblings.map((sibling) => sibling.writesWorkspace)).toEqual([true, false]);
    store.close();
  });

  it('abandons nothing for an on-path target and reports an unknown target', async () => {
    const { store } = await openStore('abandoned-edges');
    await seedLinear(store);
    expect(await store.listAbandonedAssistantRows('a1')).toEqual([]);
    expect(await store.listAbandonedAssistantRows('missing')).toBeUndefined();
    store.close();
  });

  it('abandons the whole path when the fork is at the root', async () => {
    const { store } = await openStore('abandoned-root');
    await append(store, 'u1', 'user', 'first');
    await store.appendMessage({
      id: 'a1',
      runtimeGenerationId: 'gen-a',
      backendMessageId: 'b-a1',
      role: 'assistant',
      text: 'edited',
      status: 'done',
      createdAt: '2026-08-21T00:00:02.000Z',
      metadata: { workspaceWrites: { files: [], hasUnknownWrites: true } },
    });
    await store.rebaseActiveLeaf(null);
    await append(store, 'u1-alt', 'user', 'fresh root');
    await store.switchActiveBranch('u1');
    const abandoned = await store.listAbandonedAssistantRows('u1-alt');
    expect(abandoned?.map((message) => message.id)).toEqual(['a1']);
    store.close();
  });
});
