import { describe, expect, it } from 'vitest';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import {
  appendMockTranscriptMessage,
  applyMockRetryPrompt,
  listMockBranchPoints,
  mockOffPathWrites,
  rebaseMockLeaf,
  switchMockBranch,
  truncateMockSubtree,
  visibleMockTranscript,
  type MockTranscriptTreeHost,
} from './host-client-mock-tree.js';

function row(id: string, text: string): SessionTranscriptMessage {
  return {
    id,
    role: id.startsWith('u') ? 'user' : 'assistant',
    text,
    createdAt: '2026-08-21T00:00:00.000Z',
    status: 'done',
  };
}

describe('mock conversation tree', () => {
  it('keeps an uninitialized session linear and visible', () => {
    const session: MockTranscriptTreeHost = {
      transcript: [row('u1', 'one'), row('a1', 'reply')],
    };
    expect(visibleMockTranscript(session).map((message) => message.id)).toEqual(['u1', 'a1']);
  });

  it('hides the abandoned sibling after a branch prompt rebase', () => {
    const session: MockTranscriptTreeHost = { transcript: [] };
    appendMockTranscriptMessage(session, row('u1', 'turn one'));
    appendMockTranscriptMessage(session, row('a1', 'reply one'));
    appendMockTranscriptMessage(session, row('u2', 'turn two original'));
    appendMockTranscriptMessage(session, row('a2', 'reply two'));
    rebaseMockLeaf(session, 'a1');
    appendMockTranscriptMessage(session, row('u2b', 'turn two alternative'));
    appendMockTranscriptMessage(session, row('a2b', 'reply alt'));
    expect(visibleMockTranscript(session).map((message) => message.id)).toEqual([
      'u1',
      'a1',
      'u2b',
      'a2b',
    ]);
    const points = listMockBranchPoints(session);
    expect(points).toHaveLength(1);
    expect(points[0]?.siblings.map((sibling) => sibling.headMessageId)).toEqual(['u2', 'u2b']);
    expect(points[0]?.activeIndex).toBe(1);

    const leaf = switchMockBranch(session, 'u2');
    expect(leaf).toBe('a2');
    expect(visibleMockTranscript(session).map((message) => message.id)).toEqual([
      'u1',
      'a1',
      'u2',
      'a2',
    ]);

    const deleted = truncateMockSubtree(session, 'u2b');
    expect(deleted.removedCount).toBe(2);
    expect(deleted.remainingCount).toBe(4);
    expect(listMockBranchPoints(session)).toHaveLength(0);
  });

  it('detects abandoned writes when switching away from a write branch', () => {
    const session: MockTranscriptTreeHost = { transcript: [] };
    appendMockTranscriptMessage(session, row('u1', 'one'));
    appendMockTranscriptMessage(session, row('a1', 'ok'));
    appendMockTranscriptMessage(session, row('u2', 'edit'));
    appendMockTranscriptMessage(session, {
      ...row('a2', 'wrote'),
      workspaceWrites: { files: ['src/app.ts'], hasUnknownWrites: false },
    });
    rebaseMockLeaf(session, 'a1');
    appendMockTranscriptMessage(session, row('u2b', 'other'));
    switchMockBranch(session, 'u2');
    expect(mockOffPathWrites(session, 'u2b')).toEqual({
      files: ['src/app.ts'],
      hasUnknownWrites: false,
    });
  });

  it('retries onto the user row without appending another prompt', () => {
    const session: MockTranscriptTreeHost = { transcript: [] };
    appendMockTranscriptMessage(session, row('u1', 'ask'));
    appendMockTranscriptMessage(session, row('a1', 'first'));
    const kept = applyMockRetryPrompt(session, {
      retryUserMessageId: 'u1',
      keepPrevious: true,
      confirm: false,
    });
    expect(kept.ok).toBe(true);
    appendMockTranscriptMessage(session, row('a1b', 'second'));
    expect(visibleMockTranscript(session).map((message) => message.id)).toEqual(['u1', 'a1b']);
    expect(listMockBranchPoints(session)[0]?.siblings.map((sibling) => sibling.role)).toEqual([
      'assistant',
      'assistant',
    ]);
  });

  it('discards the previous answer on retry so no fork remains', () => {
    const session: MockTranscriptTreeHost = { transcript: [] };
    appendMockTranscriptMessage(session, row('u1', 'ask'));
    appendMockTranscriptMessage(session, row('a1', 'first'));
    const discarded = applyMockRetryPrompt(session, {
      retryUserMessageId: 'u1',
      keepPrevious: false,
      confirm: false,
    });
    expect(discarded.ok).toBe(true);
    appendMockTranscriptMessage(session, row('a1b', 'second'));
    expect(visibleMockTranscript(session).map((message) => message.id)).toEqual(['u1', 'a1b']);
    expect(session.transcript.some((message) => message.id === 'a1')).toBe(false);
    expect(listMockBranchPoints(session)).toEqual([]);
  });
});
