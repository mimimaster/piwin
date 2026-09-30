import { describe, expect, it } from 'vitest';
import type { ChatMessageUi, ToolCardUi } from './chat-ui-types.js';
import type { TranscriptTurn } from './transcript-turns.js';
import {
  buildTurnWorkSegments,
  indexSegmentsByItem,
  MAX_UNNARRATED_SEGMENT_TOOLS,
  narrationTitle,
  resolveSegmentDefaultOpen,
} from './turn-work-segments.js';
import { resolveTurnFoldKey, planTurnWorkSegments } from './turn-work-segment-plan.js';

function tool(id: string, overrides: Partial<ToolCardUi> = {}): ToolCardUi {
  return { toolCallId: id, toolName: 'bash', status: 'done', output: '', ...overrides };
}

function editTool(id: string, path: string): ToolCardUi {
  return tool(id, {
    toolName: 'edit',
    presentation: { kind: 'filesystem', title: 'edit', actionVerb: 'Edited', changedPaths: [path] },
  });
}

function readTool(id: string): ToolCardUi {
  return tool(id, {
    toolName: 'read',
    presentation: { kind: 'filesystem', title: 'read', actionVerb: 'Read', targetPaths: ['a.ts'] },
  });
}

function assistant(id: string, overrides: Partial<ChatMessageUi> = {}): ChatMessageUi {
  return {
    id,
    role: 'assistant',
    text: '',
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
    runId: 'run-1',
    ...overrides,
  };
}

function turnOf(messages: ChatMessageUi[]): TranscriptTurn {
  return {
    id: `turn-${messages[0]?.id ?? 'x'}`,
    items: messages.map((message, messageIndex) => ({ message, messageIndex })),
    lastAssistantMessageId: messages[messages.length - 1]?.id ?? null,
  };
}

describe('narrationTitle', () => {
  it('takes the first readable line without Markdown chrome', () => {
    expect(narrationTitle('\n### **核对** `chat-thread` 的调用方\n\n细节')).toBe('核对 chat-thread 的调用方');
    expect(narrationTitle('- 1st bullet\n- 2nd')).toBe('1st bullet');
    expect(narrationTitle('   \n  ')).toBeUndefined();
  });

  it('caps long narration to one line', () => {
    const title = narrationTitle('x'.repeat(300));
    expect(title?.length).toBe(120);
    expect(title?.endsWith('…')).toBe(true);
  });
});

describe('buildTurnWorkSegments', () => {
  it('opens a segment at each narration and joins leading thought-only rows to it', () => {
    const turn = turnOf([
      assistant('think', { thinking: 'planning' }),
      assistant('n1', { text: 'Read the callers.', tools: [readTool('r1'), readTool('r2')] }),
      assistant('silent', { tools: [tool('b1')] }),
      assistant('n2', { text: 'Now edit.', tools: [editTool('e1', 'a.ts'), editTool('e2', 'a.ts')] }),
    ]);
    const segments = buildTurnWorkSegments(turn, 0, 3);
    expect(segments.map((segment) => [segment.startIndex, segment.endIndex, segment.title])).toEqual([
      [0, 2, 'Read the callers.'],
      [3, 3, 'Now edit.'],
    ]);
    expect(segments[0]?.stats).toMatchObject({ explore: 2, command: 1, edit: 0 });
    expect(segments[1]?.stats).toMatchObject({ edit: 2, editedFiles: 1 });
    expect(segments[0]?.id).toBe('seg-think');
  });

  it('cuts an unnarrated stretch so one silent loop is not one huge segment', () => {
    const rows = Array.from({ length: MAX_UNNARRATED_SEGMENT_TOOLS * 2 + 3 }, (_, index) =>
      assistant(`s${index}`, { tools: [tool(`t${index}`)] }),
    );
    const segments = buildTurnWorkSegments(turnOf(rows), 0, rows.length - 1);
    expect(segments.map((segment) => segment.toolCount)).toEqual([
      MAX_UNNARRATED_SEGMENT_TOOLS,
      MAX_UNNARRATED_SEGMENT_TOOLS,
      3,
    ]);
  });

  it('counts failed tools, and errored responses without one, as failures', () => {
    const turn = turnOf([
      assistant('a', { text: 'Try.', tools: [tool('x', { status: 'error' })], error: 'boom' }),
      assistant('b', { text: 'Again.', status: 'error', error: 'stream ended' }),
      assistant('c', { text: 'Live.', status: 'streaming', tools: [tool('y', { status: 'running' })] }),
    ]);
    const segments = buildTurnWorkSegments(turn, 0, 2);
    expect(segments.map((segment) => segment.stats.failed)).toEqual([1, 1, 0]);
    expect(segments[2]?.running).toBe(true);
  });

  it('indexes items back to their segment', () => {
    const turn = turnOf([assistant('a', { text: 'One.' }), assistant('b', { tools: [tool('t')] })]);
    const byItem = indexSegmentsByItem(buildTurnWorkSegments(turn, 0, 1));
    expect(byItem.get(1)?.id).toBe('seg-a');
  });
});

describe('resolveSegmentDefaultOpen', () => {
  const segment = buildTurnWorkSegments(turnOf([assistant('a', { text: 'x' })]), 0, 0)[0];
  const failing = buildTurnWorkSegments(
    turnOf([assistant('f', { text: 'x', tools: [tool('t', { status: 'error' })] })]),
    0,
    0,
  )[0];

  it('opens the newest and failing segments, nothing in compact, everything in expand-all', () => {
    if (!segment || !failing) throw new Error('fixture');
    expect(resolveSegmentDefaultOpen(segment, { isLast: false, compact: false, expandAll: false })).toBe(false);
    expect(resolveSegmentDefaultOpen(segment, { isLast: true, compact: false, expandAll: false })).toBe(true);
    expect(resolveSegmentDefaultOpen(failing, { isLast: false, compact: false, expandAll: false })).toBe(true);
    expect(resolveSegmentDefaultOpen(failing, { isLast: true, compact: true, expandAll: true })).toBe(false);
    expect(resolveSegmentDefaultOpen(segment, { isLast: false, compact: false, expandAll: true })).toBe(true);
  });
});

describe('planTurnWorkSegments', () => {
  const rows = Array.from({ length: 5 }, (_, index) =>
    assistant(`n${index}`, { text: `Step ${index}.`, tools: [tool(`t${index}`)] }),
  );
  const turn = turnOf(rows);
  const projection = { startIndex: 0, endIndex: 4, failureCount: 0 };

  it('keeps only the newest window of segments mounted', () => {
    const plan = planTurnWorkSegments({
      turn,
      projection,
      compact: false,
      expandAll: false,
      windowSize: 2,
      openOverrides: {},
    });
    expect(plan.hiddenCount).toBe(3);
    expect(plan.segments.filter(plan.isVisible).map((segment) => segment.id)).toEqual([
      'seg-n3',
      'seg-n4',
    ]);
  });

  it('lets a reader override win over the default', () => {
    const plan = planTurnWorkSegments({
      turn,
      projection,
      compact: true,
      expandAll: false,
      windowSize: 40,
      openOverrides: { 'seg-n1': true, 'seg-n4': false },
    });
    expect(plan.segments.filter(plan.isOpen).map((segment) => segment.id)).toEqual(['seg-n1']);
  });
});

describe('resolveTurnFoldKey', () => {
  it('keeps turn.id for a turn whose prompt is resident', () => {
    const user: ChatMessageUi = {
      id: 'u',
      role: 'user',
      text: 'Fix it.',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
    };
    const turn = turnOf([user, assistant('a')]);
    expect(resolveTurnFoldKey(turn)).toBe('turn-u');
  });

  it('keys a headless turn by its run so older pages do not re-key it', () => {
    const tail = turnOf([assistant('a50'), assistant('a51')]);
    const paged = turnOf([assistant('a01'), assistant('a50'), assistant('a51')]);
    expect(resolveTurnFoldKey(tail)).toBe('run:run-1');
    expect(resolveTurnFoldKey(paged)).toBe(resolveTurnFoldKey(tail));
  });
});
