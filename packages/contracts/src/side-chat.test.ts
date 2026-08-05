import { describe, expect, it } from 'vitest';
import type {
  MainContextRef,
  PromptContextRef,
  SideChatContextRef,
  SideChatContextSnapshot,
  SideChatRelation,
} from './side-chat.js';
import type { HostCommand } from './ipc.js';
import type { SessionSummary } from './host.js';
import type { SessionIndexRecord } from './session-index.js';

describe('side-chat contracts', () => {
  it('keeps side-chat relation as an independent discriminant', () => {
    const relation: SideChatRelation = {
      kind: 'side-chat',
      sourceSessionId: 'main-1',
      sourceMessageId: 'msg-9',
      sourceCapturedAt: '2026-08-05T00:00:00.000Z',
      contextVersion: 2,
      sourceState: 'active',
    };
    expect(relation.kind).toBe('side-chat');
    expect(relation).not.toHaveProperty('parentSessionId');
    expect(relation.contextVersion).toBe(2);
  });

  it('round-trips the relation and snapshot through JSON', () => {
    const snapshot: SideChatContextSnapshot = {
      version: 1,
      capturedAt: '2026-08-05T00:00:00.000Z',
      sourceSessionId: 'main-1',
      throughMessageId: 'msg-9',
      conversation: {
        messageIds: ['msg-1', 'msg-9'],
        formattedText: '[piwin-side-chat-context]\nPrior main conversation…',
        truncated: false,
      },
      workspace: {
        scope: 'project',
        projectPath: '/Users/dev/piwin',
        workingDirectory: '/Users/dev/piwin',
      },
      refs: [
        {
          kind: 'main-message',
          sourceSessionId: 'main-1',
          messageId: 'msg-9',
          label: 'Latest main reply',
        },
      ],
    };
    const roundTripped = JSON.parse(JSON.stringify(snapshot)) as SideChatContextSnapshot;
    expect(roundTripped).toEqual(snapshot);
    expect(roundTripped.conversation.formattedText).toContain('piwin-side-chat-context');
  });

  it('accepts every context ref discriminant', () => {
    const refs: SideChatContextRef[] = [
      {
        kind: 'main-message',
        sourceSessionId: 'main-1',
        messageId: 'msg-1',
        label: 'Reply',
      },
      {
        kind: 'file',
        projectPath: '/Users/dev/piwin',
        relativePath: 'src/index.ts',
        lineStart: 10,
        lineEnd: 20,
        label: 'index.ts:10-20',
      },
      {
        kind: 'diff',
        projectPath: '/Users/dev/piwin',
        snapshotText: '--- a/src/index.ts\n+++ b/src/index.ts',
        label: 'index.ts diff',
      },
      {
        kind: 'terminal-output',
        snapshotText: 'error TS2322',
        label: 'pnpm typecheck',
      },
      {
        kind: 'error',
        title: 'Type error',
        detail: 'TS2322: Type string is not assignable',
        label: 'TS2322',
      },
      {
        kind: 'side-chat-message',
        sideChatSessionId: 'side-1',
        messageId: 'msg-3',
        label: 'Side chat explanation',
      },
    ];
    for (const ref of refs) {
      expect(ref.kind).toEqual(expect.any(String));
      expect(ref.label).toEqual(expect.any(String));
    }
    expect(refs).toHaveLength(6);
  });

  it('treats main refs as valid prompt context refs (handoff path)', () => {
    const mainRef: MainContextRef = {
      kind: 'error',
      title: 'Type error',
      detail: 'TS2322',
      label: 'TS2322',
    };
    const promptRefs: PromptContextRef[] = [mainRef];
    expect(promptRefs[0]).toMatchObject({ kind: 'error' });
  });

  it('accepts side-chat host commands with the product shape', () => {
    const openCommand: HostCommand = {
      type: 'side-chat/open',
      sourceSessionId: 'main-1',
      sourceMessageId: 'msg-9',
      name: 'Explain this diff',
      refs: [{ kind: 'main-message', sourceSessionId: 'main-1', messageId: 'msg-9', label: 'R' }],
    };
    const listCommand: HostCommand = { type: 'side-chat/list', sourceSessionId: 'main-1' };
    const syncCommand: HostCommand = { type: 'side-chat/sync', sideChatSessionId: 'side-1' };
    expect(openCommand.type).toBe('side-chat/open');
    expect(listCommand.type).toBe('side-chat/list');
    expect(syncCommand.type).toBe('side-chat/sync');
  });

  it('extends the session kind and relation on summaries and index records', () => {
    const summary: SessionSummary = {
      id: 'side-1',
      scope: { kind: 'general' },
      workingDirectory: '',
      projectPath: '',
      updatedAt: '2026-08-05T00:00:00.000Z',
      messageCount: 3,
      kind: 'side-chat',
      sideChatRelation: {
        kind: 'side-chat',
        sourceSessionId: 'main-1',
        sourceCapturedAt: '2026-08-05T00:00:00.000Z',
        contextVersion: 1,
        sourceState: 'active',
      },
    };
    const record: SessionIndexRecord = {
      id: 'side-1',
      projectPath: '',
      createdAt: '2026-08-05T00:00:00.000Z',
      updatedAt: '2026-08-05T00:00:00.000Z',
      messageCount: 3,
      kind: 'side-chat',
    };
    expect(summary.kind).toBe('side-chat');
    expect(summary.sideChatRelation?.sourceSessionId).toBe('main-1');
    expect(record.kind).toBe('side-chat');
  });
});
