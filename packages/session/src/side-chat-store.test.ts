import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionIndexRecord, SessionTranscriptMessage } from '@piwin/contracts';
import {
  buildSideChatContextSnapshot,
  formatSideChatContextBlock,
  mergeSideChatContextIntoPrompt,
} from './side-chat-context.js';
import {
  createSideChatSessionRecord,
  getSideChatSessionRecord,
  listSideChatSessions,
  markSideChatSourceState,
  updateSideChatContext,
} from './side-chat-store.js';
import {
  createSessionRecord,
  deleteSessionRecord,
  listSessionsForProject,
  upsertSessionRecord,
} from './session-index-store.js';
import { searchSessions } from './session-search.js';

function makeMessage(id: string, role: SessionTranscriptMessage['role'], text: string): SessionTranscriptMessage {
  return {
    id,
    role,
    text,
    createdAt: '2026-08-05T00:00:00.000Z',
    status: 'done',
  };
}

function sideRelation(overrides: Partial<SessionIndexRecord['sideChatRelation']> = {}) {
  return {
    kind: 'side-chat' as const,
    sourceSessionId: 'main-1',
    sourceMessageId: 'msg-9',
    sourceCapturedAt: '2026-08-05T00:00:00.000Z',
    contextVersion: 1,
    sourceState: 'active' as const,
    ...overrides,
  };
}

describe('side-chat-context snapshot builder', () => {
  it('builds a bounded snapshot with the labeled inherited block', () => {
    const snapshot = buildSideChatContextSnapshot({
      version: 1,
      sourceSessionId: 'main-1',
      throughMessageId: 'msg-9',
      workspace: {
        scope: 'project',
        projectPath: '/Users/dev/piwin',
        workingDirectory: '/Users/dev/piwin',
      },
      messages: [
        makeMessage('msg-1', 'user', 'Refactor the resolver'),
        makeMessage('msg-9', 'assistant', 'Here is the plan.'),
      ],
    });
    expect(snapshot.version).toBe(1);
    expect(snapshot.throughMessageId).toBe('msg-9');
    expect(snapshot.conversation.messageIds).toEqual(['msg-1', 'msg-9']);
    expect(snapshot.conversation.formattedText).toContain('<inherited_conversation');
    expect(snapshot.conversation.formattedText).toContain('Refactor the resolver');
    expect(snapshot.conversation.truncated).toBe(false);
  });

  it('caps the window and marks truncation', () => {
    const messages = Array.from({ length: 12 }, (_, index) =>
      makeMessage(`msg-${index}`, 'user', `Message ${index}`),
    );
    const snapshot = buildSideChatContextSnapshot({
      version: 2,
      sourceSessionId: 'main-1',
      workspace: { scope: 'general', workingDirectory: '' },
      messages,
      maxMessages: 5,
    });
    expect(snapshot.conversation.messageIds).toHaveLength(5);
    expect(snapshot.conversation.messageIds[4]).toBe('msg-11');
    expect(snapshot.conversation.truncated).toBe(true);
  });

  it('caps characters', () => {
    const long = 'x'.repeat(2000);
    const snapshot = buildSideChatContextSnapshot({
      version: 1,
      sourceSessionId: 'main-1',
      workspace: { scope: 'general', workingDirectory: '' },
      messages: [makeMessage('msg-1', 'user', long)],
      maxChars: 500,
    });
    expect(snapshot.conversation.formattedText.length).toBeLessThan(800);
  });

  it('formats and merges the context block distinctly from user text', () => {
    const snapshot = buildSideChatContextSnapshot({
      version: 1,
      sourceSessionId: 'main-1',
      workspace: { scope: 'general', workingDirectory: '' },
      messages: [makeMessage('msg-1', 'user', 'Context content')],
    });
    const block = formatSideChatContextBlock(snapshot);
    expect(block).toContain('<side_chat_context');
    const merged = mergeSideChatContextIntoPrompt(block, 'Explain that approach');
    expect(merged).toContain('<side_chat_context');
    expect(merged).toContain('<inherited_conversation');
    expect(merged).toContain('Explain that approach');
  });
});

describe('side-chat-store', () => {
  async function tempIndexPath(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-side-'));
    return join(dir, 'index.json');
  }

  async function seedMainSession(indexPath: string, id = 'main-1'): Promise<SessionIndexRecord> {
    const record = createSessionRecord({
      id,
      projectPath: '/tmp/proj',
      name: 'Main session',
      nameSource: 'text',
    });
    await upsertSessionRecord(indexPath, record);
    return record;
  }

  it('creates a side chat record that is invisible to the main list', async () => {
    const indexPath = await tempIndexPath();
    await seedMainSession(indexPath);
    const snapshot = buildSideChatContextSnapshot({
      version: 1,
      sourceSessionId: 'main-1',
      workspace: { scope: 'project', projectPath: '/tmp/proj', workingDirectory: '/tmp/proj' },
      messages: [makeMessage('msg-1', 'user', 'hi')],
    });
    await createSideChatSessionRecord(indexPath, {
      id: 'side-1',
      projectPath: '/tmp/proj',
      scope: { kind: 'project', projectPath: '/tmp/proj' },
      workingDirectory: '/tmp/proj',
      name: 'Side Chat · Main session',
      relation: sideRelation(),
      context: snapshot,
    });

    const mainList = await listSessionsForProject(indexPath, '/tmp/proj');
    expect(mainList.map((item) => item.id)).toEqual(['main-1']);

    const sideChats = await listSideChatSessions(indexPath, 'main-1');
    expect(sideChats).toHaveLength(1);
    expect(sideChats[0]?.id).toBe('side-1');
    expect(sideChats[0]?.kind).toBe('side-chat');
    expect(sideChats[0]?.parentSessionId).toBeUndefined();
  });

  it('lists side chats newest first and respects archived filter', async () => {
    const indexPath = await tempIndexPath();
    await seedMainSession(indexPath);
    for (const id of ['side-old', 'side-new']) {
      await createSideChatSessionRecord(indexPath, {
        id,
        projectPath: '/tmp/proj',
        scope: { kind: 'project', projectPath: '/tmp/proj' },
        workingDirectory: '/tmp/proj',
        name: `Side Chat ${id}`,
        relation: sideRelation(),
        context: buildSideChatContextSnapshot({
          version: 1,
          sourceSessionId: 'main-1',
          workspace: { scope: 'project', projectPath: '/tmp/proj', workingDirectory: '/tmp/proj' },
          messages: [],
        }),
      });
    }
    const ordered = await listSideChatSessions(indexPath, 'main-1');
    expect(ordered.map((item) => item.id)).toEqual(['side-new', 'side-old']);
  });

  it('sync increments context version without rewriting the side transcript', async () => {
    const indexPath = await tempIndexPath();
    await seedMainSession(indexPath);
    await createSideChatSessionRecord(indexPath, {
      id: 'side-1',
      projectPath: '/tmp/proj',
      scope: { kind: 'project', projectPath: '/tmp/proj' },
      workingDirectory: '/tmp/proj',
      name: 'Side Chat',
      relation: sideRelation(),
      context: buildSideChatContextSnapshot({
        version: 1,
        sourceSessionId: 'main-1',
        workspace: { scope: 'project', projectPath: '/tmp/proj', workingDirectory: '/tmp/proj' },
        messages: [],
      }),
    });
    const next = buildSideChatContextSnapshot({
      version: 2,
      sourceSessionId: 'main-1',
      throughMessageId: 'msg-10',
      workspace: { scope: 'project', projectPath: '/tmp/proj', workingDirectory: '/tmp/proj' },
      messages: [makeMessage('msg-10', 'assistant', 'newer reply')],
    });
    const updated = await updateSideChatContext(indexPath, 'side-1', next);
    expect(updated?.sideChatRelation?.contextVersion).toBe(2);
    expect(updated?.sideChatContext?.throughMessageId).toBe('msg-10');

    const reloaded = await getSideChatSessionRecord(indexPath, 'side-1');
    expect(reloaded?.sideChatContext?.conversation.messageIds).toEqual(['msg-10']);
  });

  it('marks source archived/missing without deleting side chats', async () => {
    const indexPath = await tempIndexPath();
    await seedMainSession(indexPath);
    await createSideChatSessionRecord(indexPath, {
      id: 'side-1',
      projectPath: '/tmp/proj',
      scope: { kind: 'project', projectPath: '/tmp/proj' },
      workingDirectory: '/tmp/proj',
      name: 'Side Chat',
      relation: sideRelation(),
      context: buildSideChatContextSnapshot({
        version: 1,
        sourceSessionId: 'main-1',
        workspace: { scope: 'project', projectPath: '/tmp/proj', workingDirectory: '/tmp/proj' },
        messages: [],
      }),
    });

    await markSideChatSourceState(indexPath, 'main-1', 'archived');
    let sideChat = await getSideChatSessionRecord(indexPath, 'side-1');
    expect(sideChat?.sideChatRelation?.sourceState).toBe('archived');

    await deleteSessionRecord(indexPath, 'main-1');
    await markSideChatSourceState(indexPath, 'main-1', 'missing');
    sideChat = await getSideChatSessionRecord(indexPath, 'side-1');
    expect(sideChat?.sideChatRelation?.sourceState).toBe('missing');
    // Frozen side chat transcript stays available for resume (no cascade).
    expect(sideChat?.sideChatContext).toBeDefined();
  });

  it('excludes side chats from main session search', async () => {
    const indexPath = await tempIndexPath();
    await seedMainSession(indexPath);
    await createSideChatSessionRecord(indexPath, {
      id: 'side-1',
      projectPath: '/tmp/proj',
      scope: { kind: 'project', projectPath: '/tmp/proj' },
      workingDirectory: '/tmp/proj',
      name: 'Side Chat · Main session',
      relation: sideRelation(),
      context: buildSideChatContextSnapshot({
        version: 1,
        sourceSessionId: 'main-1',
        workspace: { scope: 'project', projectPath: '/tmp/proj', workingDirectory: '/tmp/proj' },
        messages: [],
      }),
    });
    const result = await searchSessions({ indexPath }, { query: 'Main session', limit: 20 });
    expect(result.hits.map((hit) => hit.sessionId)).toEqual(['main-1']);
  });
});
