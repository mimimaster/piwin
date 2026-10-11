import type { QueuedTurnRecord } from '@piwin/contracts';
import { describe, expect, it } from 'vitest';
import {
  applyQueuedTurn,
  describePromptExtras,
  describeQueue,
  moveQueuedTurn,
  pendingQueuedTurns,
  queuedTurnItems,
} from './queued-turns.js';

function turn(patch: Partial<QueuedTurnRecord> & { queuedTurnId: string }): QueuedTurnRecord {
  return {
    revision: 1,
    sessionId: 's1',
    sequence: 1,
    userMessageId: `user-${patch.queuedTurnId}`,
    mode: 'next',
    status: 'pending',
    input: { text: patch.queuedTurnId },
    submittedAt: '',
    updatedAt: '',
    ...patch,
  };
}

describe('applyQueuedTurn', () => {
  it('keeps pending turns in queue order and drops one that started or was cancelled', () => {
    let pending = applyQueuedTurn([], turn({ queuedTurnId: 'b', sequence: 2 }));
    pending = applyQueuedTurn(pending, turn({ queuedTurnId: 'a', sequence: 1 }));
    expect(pending.map((entry) => entry.queuedTurnId)).toEqual(['a', 'b']);
    pending = applyQueuedTurn(pending, turn({ queuedTurnId: 'a', sequence: 1, revision: 2, status: 'started' }));
    expect(pending.map((entry) => entry.queuedTurnId)).toEqual(['b']);
    pending = applyQueuedTurn(pending, turn({ queuedTurnId: 'b', sequence: 2, revision: 2, status: 'cancelled' }));
    expect(pending).toEqual([]);
  });

  it('replaces an edited turn and ignores a stale revision', () => {
    const edited = turn({ queuedTurnId: 'a', revision: 3, input: { text: 'new' } });
    let pending = applyQueuedTurn([turn({ queuedTurnId: 'a' })], edited);
    expect(pending[0]?.input.text).toBe('new');
    pending = applyQueuedTurn(pending, turn({ queuedTurnId: 'a', revision: 2, status: 'cancelled' }));
    expect(pending).toEqual([edited]);
  });
});

describe('moveQueuedTurn', () => {
  const pending = ['a', 'b', 'c'].map((queuedTurnId, index) => turn({ queuedTurnId, sequence: index }));

  it('moves a turn one place or to the front', () => {
    expect(moveQueuedTurn(pending, 'c', 'up')).toEqual(['a', 'c', 'b']);
    expect(moveQueuedTurn(pending, 'a', 'down')).toEqual(['b', 'a', 'c']);
    expect(moveQueuedTurn(pending, 'c', 'top')).toEqual(['c', 'a', 'b']);
  });

  it('has nothing to do at the edges or for an unknown turn', () => {
    expect(moveQueuedTurn(pending, 'a', 'up')).toBeUndefined();
    expect(moveQueuedTurn(pending, 'a', 'top')).toBeUndefined();
    expect(moveQueuedTurn(pending, 'c', 'down')).toBeUndefined();
    expect(moveQueuedTurn(pending, 'zz', 'up')).toBeUndefined();
  });
});

describe('queue presentation', () => {
  it('filters a Host listing down to what is still waiting', () => {
    const listed = [
      turn({ queuedTurnId: 'done', status: 'started' }),
      turn({ queuedTurnId: 'b', sequence: 3 }),
      turn({ queuedTurnId: 'a', sequence: 2, status: 'starting' }),
    ];
    expect(pendingQueuedTurns(listed).map((entry) => entry.queuedTurnId)).toEqual(['a', 'b']);
    expect(describeQueue(pendingQueuedTurns(listed))).toBe('排队 2');
    expect(describeQueue([])).toBeUndefined();
  });

  it('previews each turn on one line with what it carries', () => {
    const items = queuedTurnItems([
      turn({
        queuedTurnId: 'a',
        input: {
          text: `看看\n${'长'.repeat(80)}`,
          contextRefs: [{ kind: 'folder', projectPath: 'p', relativePath: 'src', label: 'src' }],
          attachments: [
            { id: 'm1', kind: 'media', path: 'remote-asset:m1', mimeType: 'image/png', name: 'a.png', byteSize: 1, source: 'paste' },
          ],
        },
      }),
      turn({ queuedTurnId: 'b', input: { text: '  ' } }),
    ]);
    expect(items[0]?.label).toBe(`1. 看看 ${'长'.repeat(57)}…`);
    expect(items[0]?.description).toBe('@src/ 附件 a.png');
    expect(items[1]).toEqual({ value: 'b', label: '2. （无文字）' });
  });

  it('lists file refs and attachments of a prompt input', () => {
    expect(
      describePromptExtras({
        text: '',
        contextRefs: [
          { kind: 'file', projectPath: 'p', relativePath: 'a.ts', label: 'a.ts' },
          { kind: 'terminal-output', snapshotText: 'x', label: 'out' },
        ],
      }),
    ).toEqual(['@a.ts']);
  });
});
