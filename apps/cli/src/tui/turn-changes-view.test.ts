import type { TurnChangeSummary } from '@piwin/contracts';
import { describe, expect, it } from 'vitest';
import { EMPTY_TRANSCRIPT, appendLocalUserMessage, applyAgentEvent } from './transcript-model.js';
import {
  describeBlocked,
  describeDispositionChange,
  describeRefusal,
  transcriptRunIds,
  turnChangeActionItems,
  turnChangeItems,
  turnsWithChanges,
} from './turn-changes-view.js';

const allow = { allowed: true } as const;

function summary(patch: Partial<TurnChangeSummary> & { changeSetId: string }): TurnChangeSummary {
  return {
    attemptId: 'a',
    sessionId: 's1',
    workspaceId: 'w',
    userMessageId: null,
    runIds: [],
    revision: 1,
    captureState: 'ready',
    disposition: 'applied',
    fileCount: 2,
    additions: 10,
    deletions: 3,
    binaryFileCount: 0,
    coverageComplete: true,
    undo: allow,
    redo: { allowed: false, reason: 'direction-unavailable' },
    expiresAt: null,
    latestOperationId: null,
    ...patch,
  };
}

function transcript() {
  let state = appendLocalUserMessage(EMPTY_TRANSCRIPT, 'u1', '加一个登录页');
  state = applyAgentEvent(state, { type: 'message/start', messageId: 'a1', role: 'assistant', runId: 'run-1' });
  state = appendLocalUserMessage(state, 'u2', '再加上记住我');
  state = applyAgentEvent(state, { type: 'message/start', messageId: 'a2', role: 'assistant', runId: 'run-2' });
  state = applyAgentEvent(state, { type: 'message/start', messageId: 'a3', role: 'assistant', runId: 'run-2' });
  return state;
}

describe('turn change listing', () => {
  it('collects each run once in transcript order', () => {
    expect(transcriptRunIds(transcript())).toEqual(['run-1', 'run-2']);
  });

  it('keeps turns that touched files, newest first', () => {
    const turns = turnsWithChanges(
      [
        summary({ changeSetId: 'first', runIds: ['run-1'] }),
        summary({ changeSetId: 'empty', runIds: ['run-2'], fileCount: 0 }),
        summary({ changeSetId: 'second', runIds: ['run-2'] }),
        summary({ changeSetId: 'broken', runIds: ['run-1'], fileCount: null, captureState: 'incomplete' }),
      ],
      ['run-1', 'run-2'],
    );
    expect(turns.map((turn) => turn.changeSetId)).toEqual(['second', 'first', 'broken']);
  });

  it('labels a turn by its prompt and summarises what it changed', () => {
    const items = turnChangeItems(
      [
        summary({ changeSetId: 'c1', userMessageId: 'u2', disposition: 'undone' }),
        summary({ changeSetId: 'c2', userMessageId: 'gone', fileCount: null, additions: null, coverageComplete: false }),
      ],
      transcript(),
    );
    expect(items).toEqual([
      { value: 'c1', label: '再加上记住我', description: '2 个文件 +10 −3 · 已撤销' },
      { value: 'c2', label: '（提问不在当前页）', description: '改动未知 · 记录不完整' },
    ]);
  });
});

describe('turn change actions', () => {
  it('offers undo for an applied turn and redo for an undone one', () => {
    expect(turnChangeActionItems(summary({ changeSetId: 'c' })).map((item) => item.value)).toEqual(['files', 'undo', 'close']);
    const undone = summary({ changeSetId: 'c', disposition: 'undone', redo: allow });
    expect(turnChangeActionItems(undone).map((item) => item.value)).toEqual(['files', 'redo', 'close']);
  });

  it('explains a refusal with the files in the way', () => {
    const blocked = summary({
      changeSetId: 'c',
      undo: {
        allowed: false,
        reason: 'files-changed',
        conflicts: [{ relativePath: 'src/a.ts', laterTurns: [] }, { relativePath: 'src/b.ts', laterTurns: [] }],
      },
    });
    expect(turnChangeActionItems(blocked)[1]).toEqual({
      value: 'close',
      label: '撤销这一轮的改动（不可用）',
      description: '这些文件之后又被改过：src/a.ts、src/b.ts',
    });
    expect(describeBlocked({ allowed: false, reason: 'capture-pending' })).toBe('这一轮还在进行或尚未记录完');
    expect(describeBlocked(allow)).toBeUndefined();
  });

  it('puts a refusal code into words and passes other errors through', () => {
    expect(describeRefusal('workspace-busy')).toBe('工作区正忙');
    expect(describeRefusal('connection lost')).toBe('connection lost');
    expect(describeRefusal('unsupported-capability')).toBe('这个 Host 没有记录文件改动');
  });

  it('shortens a long list of blocking paths', () => {
    const affectedPaths = Array.from({ length: 9 }, (_, index) => `f${index}.ts`);
    expect(describeBlocked({ allowed: false, reason: 'permission-denied', affectedPaths })).toBe(
      '没有读写这些文件的权限：f0.ts、f1.ts、f2.ts、f3.ts、f4.ts、f5.ts 等 9 个',
    );
  });
});

describe('describeDispositionChange', () => {
  it('announces an undo and a redo, and nothing for a first sighting or no change', () => {
    const applied = summary({ changeSetId: 'c' });
    const undone = summary({ changeSetId: 'c', disposition: 'undone', leftInPlacePaths: ['x.log'] });
    expect(describeDispositionChange(applied, undone)).toBe('已撤销 2 个文件的改动（1 个之后被改过的文件保持原样）');
    expect(describeDispositionChange(undone, applied)).toBe('已恢复 2 个文件的改动');
    expect(describeDispositionChange(undefined, undone)).toBeUndefined();
    expect(describeDispositionChange(applied, applied)).toBeUndefined();
  });
});
