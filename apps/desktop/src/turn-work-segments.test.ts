import { describe, expect, it } from 'vitest';
import type { ChatMessageUi, ToolCardUi } from './chat-ui-types.js';
import type { TranscriptTurn } from './transcript-turns.js';
import {
  buildTurnWorkSegments,
  indexSegmentsByItem,
  narrationTitle,
  resolveSegmentDefaultOpen,
  resolveSegmentLiveActions,
} from './turn-work-segments.js';
import { projectTurnWorkDisclosure } from './turn-work-disclosure-model.js';
import { planTurnWorkSegments } from './turn-work-segment-plan.js';

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

  it('keeps a long silent stretch in one segment: only narration cuts', () => {
    // A tool-count cut split the cross-message explore capsule: its anchor sat in
    // one segment and its live tail in the next, so both headers spun on the same
    // running read and disagreed about the tool count.
    const total = 31;
    const rows = Array.from({ length: total }, (_, index) =>
      assistant(`s${index}`, { tools: [readTool(`t${index}`)] }),
    );
    const segments = buildTurnWorkSegments(turnOf(rows), 0, total - 1);
    expect(segments.map((segment) => segment.toolCount)).toEqual([total]);
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

  it('remembers which message opened the segment: its words are the prose', () => {
    const turn = turnOf([
      assistant('quiet', { tools: [tool('a')] }),
      assistant('n1', { text: 'Reading.', tools: [tool('b')] }),
      assistant('more', { tools: [tool('c')] }),
      assistant('n2', { text: 'Editing.', tools: [tool('d')] }),
    ]);
    const segments = buildTurnWorkSegments(turn, 0, 3);
    // An unnarrated opening stretch has no prose; each later segment's prose
    // is the message that carried its narration, not merely its first row.
    expect(segments.map((segment) => segment.narrationItemIndex)).toEqual([undefined, 1, 3]);
    expect(segments.every((segment) => segment.summary.toolCount === segment.toolCount)).toBe(true);
  });

  it('a thought-only lead-in joins the narration after it, which stays the prose', () => {
    const turn = turnOf([
      assistant('think', { thinking: 'hmm' }),
      assistant('n1', { text: 'Reading.', tools: [tool('b')] }),
    ]);
    const [segment] = buildTurnWorkSegments(turn, 0, 1);
    expect(segment?.startIndex).toBe(0);
    expect(segment?.narrationItemIndex).toBe(1);
  });

  it('counts a segment exactly like the turn fold header counts its range', () => {
    const turn = turnOf([
      assistant('n1', {
        text: 'Working.',
        tools: [
          editTool('e1', 'src/a.ts'),
          readTool('r1'),
          tool('f1', { status: 'error' }),
          tool('cancelled', { status: 'error', presentation: { kind: 'shell', title: 'bash', error: { category: 'cancelled', message: 'stopped' } } }),
        ],
      }),
      assistant('answer', { text: 'Done.' }),
    ]);
    const [segment] = buildTurnWorkSegments(turn, 0, 0);
    const projection = projectTurnWorkDisclosure({
      turn,
      runRecordsById: {},
      activeRunId: null,
      currentTurnStreaming: false,
    });
    expect(segment?.summary.toolCount).toBe(projection?.toolCount);
    expect(segment?.summary.fileCount).toBe(projection?.fileCount);
    // A cancelled tool is not a failure, here or in the turn header.
    expect(segment?.summary.failureCount).toBe(1);
    expect(projection?.failureCount).toBe(1);
  });

  it('measures a segment from its first message to its last tool, else to the next message', () => {
    const at = (iso: string): string => iso;
    const withEnd = buildTurnWorkSegments(
      turnOf([
        assistant('n1', {
          text: 'Go.',
          createdAt: at('2026-09-30T10:00:00.000Z'),
          tools: [
            tool('t', {
              presentation: {
                kind: 'shell',
                title: 'bash',
                endedAt: '2026-09-30T10:02:30.000Z',
              },
            }),
          ],
        }),
      ]),
      0,
      0,
    )[0];
    expect(withEnd?.summary.elapsedMs).toBe(150_000);
    expect(withEnd?.summary.startedAt).toBe(Date.parse('2026-09-30T10:00:00.000Z'));

    const nextStart = buildTurnWorkSegments(
      turnOf([
        assistant('n1', { text: 'Go.', createdAt: at('2026-09-30T10:00:00.000Z'), tools: [tool('t')] }),
        assistant('n2', { text: 'Then.', createdAt: at('2026-09-30T10:01:00.000Z'), tools: [tool('u')] }),
      ]),
      0,
      0,
    )[0];
    expect(nextStart?.summary.elapsedMs).toBe(60_000);

    const untimed = buildTurnWorkSegments(turnOf([assistant('n1', { text: 'Go.', tools: [tool('t')] })]), 0, 0)[0];
    expect(untimed?.summary.elapsedMs).toBeUndefined();
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

  it('opens the newest and failing segments, everything in expand-all', () => {
    if (!segment || !failing) throw new Error('fixture');
    expect(resolveSegmentDefaultOpen(segment, { isLast: false, expandAll: false })).toBe(false);
    expect(resolveSegmentDefaultOpen(segment, { isLast: true, expandAll: false })).toBe(true);
    expect(resolveSegmentDefaultOpen(failing, { isLast: false, expandAll: false })).toBe(true);
    expect(resolveSegmentDefaultOpen(segment, { isLast: false, expandAll: true })).toBe(true);
  });

  it('keeps a running segment folded — its header names what is in flight — unless it failed', () => {
    const running = buildTurnWorkSegments(
      turnOf([assistant('r', { text: 'x', status: 'streaming', tools: [tool('t', { status: 'running' })] })]),
      0,
      0,
    )[0];
    const runningFailed = buildTurnWorkSegments(
      turnOf([
        assistant('rf', {
          text: 'x',
          tools: [tool('bad', { status: 'error' }), tool('t', { status: 'running' })],
        }),
      ]),
      0,
      0,
    )[0];
    if (!running || !runningFailed) throw new Error('fixture');
    expect(resolveSegmentDefaultOpen(running, { isLast: true, expandAll: false })).toBe(false);
    expect(resolveSegmentDefaultOpen(running, { isLast: true, expandAll: true })).toBe(true);
    expect(resolveSegmentDefaultOpen(runningFailed, { isLast: true, expandAll: false })).toBe(true);
  });
});

describe('resolveSegmentLiveActions', () => {
  const bash = (id: string, command: string, status: ToolCardUi['status']): ToolCardUi =>
    tool(id, { status, presentation: { kind: 'shell', title: 'bash', command } });

  it('lists every tool still running, so the header can rotate through them', () => {
    const turn = turnOf([
      assistant('a', { text: 'Go.', tools: [bash('1', 'pnpm typecheck', 'done'), bash('2', 'pnpm test', 'running')] }),
      assistant('b', { tools: [bash('3', 'pnpm build', 'running')] }),
    ]);
    const [segment] = buildTurnWorkSegments(turn, 0, 1);
    expect(resolveSegmentLiveActions(turn, segment ?? { startIndex: 0, endIndex: 1 })).toEqual([
      { toolName: 'bash', target: 'pnpm test' },
      { toolName: 'bash', target: 'pnpm build' },
    ]);
  });

  it('falls back to the latest finished tool, then to nothing', () => {
    const turn = turnOf([
      assistant('a', { text: 'Go.', tools: [bash('1', 'pnpm typecheck', 'done'), readTool('r')] }),
    ]);
    const [segment] = buildTurnWorkSegments(turn, 0, 0);
    expect(resolveSegmentLiveActions(turn, segment ?? { startIndex: 0, endIndex: 0 })).toEqual([
      { toolName: 'read', target: 'a.ts' },
    ]);
    expect(resolveSegmentLiveActions(turnOf([assistant('x', { text: 'Thinking.' })]), { startIndex: 0, endIndex: 0 })).toEqual([]);
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
      expandAll: false,
      windowSize: 40,
      openOverrides: { 'seg-n1': true, 'seg-n4': false },
    });
    expect(plan.segments.filter(plan.isOpen).map((segment) => segment.id)).toEqual(['seg-n1']);
  });
});
