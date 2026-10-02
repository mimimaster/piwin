import { describe, expect, it } from 'vitest';
import type { ToolPresentation } from '@piwin/contracts';
import { handleRemotePush, readSessionMessages, type MobileTranscriptMessage, type MobileToolCall } from '../../mobile-transcript.js';
import {
  formatToolDuration,
  projectToolRow,
  readQuestionPrompt,
  shortenPath,
  toolRowIcon,
} from './tool-row-view.js';

describe('toolRowIcon', () => {
  it('buckets by Host kind first, then splits filesystem by read / write / search', () => {
    expect(toolRowIcon('shell', 'bash', false)).toBe('term');
    expect(toolRowIcon('filesystem', 'read', false)).toBe('file');
    expect(toolRowIcon('filesystem', 'edit', false)).toBe('edit');
    expect(toolRowIcon('filesystem', 'anything', true)).toBe('edit');
    expect(toolRowIcon('filesystem', 'grep', false)).toBe('search');
    expect(toolRowIcon('web', 'web_fetch', false)).toBe('globe');
    expect(toolRowIcon('mcp', 'github__list_issues', false)).toBe('puzzle');
  });

  it('rescues untyped tools by name and falls back to a neutral glyph', () => {
    expect(toolRowIcon(undefined, 'bash', false)).toBe('term');
    expect(toolRowIcon('other', 'code_search', false)).toBe('search');
    expect(toolRowIcon('other', 'questionnaire', false)).toBe('chat');
    expect(toolRowIcon('other', 'flashcard_create', false)).toBe('bolt');
  });
});

describe('projectToolRow', () => {
  it('uses the Host command as the argument chip', () => {
    const row = projectToolRow({
      id: 't1',
      name: 'bash',
      status: 'done',
      presentation: { kind: 'shell', title: 'bash', command: 'ls -la\necho done', exitCode: 0, durationMs: 6200 },
    });
    expect(row).toMatchObject({ verb: 'bash', arg: 'ls -la', status: 'done', meta: ['6.2s'] });
    expect(row.failure).toBeUndefined();
  });

  it('marks a non-zero exit as a failure even when the tool call succeeded', () => {
    const row = projectToolRow({
      id: 't1',
      name: 'bash',
      status: 'done',
      presentation: { kind: 'shell', title: 'bash', command: 'pnpm test', exitCode: 1 },
    });
    expect(row.status).toBe('fail');
    expect(row.failure).toBe('退出码 1');
  });

  it('shows the question for questionnaire tools instead of the JSON dump', () => {
    const row = projectToolRow({
      id: 't1',
      name: 'questionnaire',
      status: 'done',
      presentation: {
        kind: 'other',
        title: 'questionnaire',
        inputPreview: '{"questions":[{"id":"drink","prompt":"你最喜欢的饮料是什么？","options":["咖啡","茶","可乐","酒（红酒…',
      },
    });
    expect(row.arg).toBe('你最喜欢的饮料是什么？');
    expect(row.question).toBe('你最喜欢的饮料是什么？');
  });

  it('never renders an argument dump summary as the chip', () => {
    const row = projectToolRow({
      id: 't1',
      name: 'mystery',
      status: 'done',
      presentation: { kind: 'other', title: 'mystery', summary: '{"a":1}' },
    });
    expect(row.arg).toBeUndefined();
  });

  it('reports writes and path counts', () => {
    const row = projectToolRow({
      id: 't1',
      name: 'write_file',
      status: 'running',
      presentation: {
        kind: 'filesystem',
        title: 'write_file',
        targetPaths: ['a.ts', 'b.ts'],
        changedPaths: ['a.ts'],
        durationMs: 40,
      },
    });
    expect(row).toMatchObject({ arg: 'a.ts +1', status: 'run', isWrite: true, meta: [] });
  });
});

describe('subagent rows', () => {
  it('reads the delegated task from a bounded preview and uses a readable verb', () => {
    const row = projectToolRow({
      id: 't1',
      name: 'piwin_subagent_start',
      status: 'done',
      presentation: {
        kind: 'subagent',
        title: 'Subagent',
        summary: 'sleep-A',
        inputPreview: '{"task":"Run exactly one shell command: `sleep 8`\\n\\nRules:\\n- Do…',
      },
    });
    expect(row.verb).toBe('委派子代理');
    expect(row.arg).toBe('sleep-A');
    expect(row.subagent?.task).toContain('Run exactly one shell command');
  });

  it('lists wait runs with Host execution status and child links', () => {
    const row = projectToolRow({
      id: 't2',
      name: 'piwin_subagent_wait',
      status: 'running',
      presentation: {
        kind: 'other',
        title: 'piwin_subagent_wait',
        subagentControl: {
          phase: 'waiting',
          total: 1,
          completed: 0,
          failed: 0,
          cancelled: 0,
          needsIntegration: 0,
          runs: [{ runId: 'run-1', title: 'explorer', executionStatus: 'running', childSessionId: 'child-1' }],
        },
      },
    });
    expect(row.verb).toBe('等待子代理');
    expect(row.subagent?.runs).toEqual([
      {
        runId: 'run-1',
        title: 'explorer',
        status: 'running',
        statusLabel: '运行中',
        activity: undefined,
        summary: undefined,
        lifecycle: [],
        childSessionId: 'child-1',
      },
    ]);
  });
});

const result = { resultId: 'result-1', revision: 2 };
const heads: ToolPresentation[] = [
  { kind: 'other', title: 'goal_complete', goal: { phase: 'completed', summary: 'Done', verification: 'tests passed', artifacts: ['/Users/public/project/app.ts'] } },
  { kind: 'other', title: 'goal_blocked', goal: { phase: 'blocked', reason: 'Needs decision', unblockAction: 'Choose scope' } },
  { kind: 'other', title: 'goal_wait', goal: { phase: 'waited', reason: 'CI queue', durationSeconds: 10 } },
  { kind: 'other', title: 'read', subagentLoop: { kind: 'result-read', result, mode: 'diff', summary: 'Candidate summary' } },
  { kind: 'other', title: 'review', subagentLoop: { kind: 'review-submit', target: result, reviewRef: { reviewId: 'review-1', revision: 3 }, decision: 'changes-requested' } },
  { kind: 'other', title: 'apply', subagentLoop: { kind: 'result-apply', result, operationId: 'op-1', integrationStatus: 'applied' } },
  { kind: 'other', title: 'discard', subagentLoop: { kind: 'result-discard', result, integrationStatus: 'retained', alreadySettled: true } },
  { kind: 'other', title: 'verify', subagentLoop: { kind: 'verification-submit', result, verificationRef: { verificationId: 'verification-1', revision: 4 }, status: 'failed' } },
  { kind: 'subagent', title: 'start', subagentControl: { phase: 'accepted', runId: 'run-1', invocationId: 'inv-1', task: 'Bounded task', childSessionId: 'child-1' } },
  ...(['waiting', 'waited'] as const).map((phase): ToolPresentation => ({ kind: 'other', title: 'wait', subagentControl: { phase, total: 2, completed: 0, failed: 1, cancelled: 1, needsIntegration: 1, runs: [
    { runId: 'run-1', executionStatus: 'failed', summaryStatus: 'failed', integrationStatus: 'retained', activity: 'Test run', summaryPreview: 'Failure retained', childSessionId: 'child-1' },
    { runId: 'run-2', executionStatus: 'cancelled', summaryStatus: 'not-requested', integrationStatus: 'not-requested' },
  ] } })),
  ...(['cancelling', 'cancelled'] as const).map((phase): ToolPresentation => ({ kind: 'other', title: 'cancel', subagentControl: { phase, total: 1, cancelled: 1, alreadyTerminal: 0, runs: [{ runId: 'run-2', executionStatus: 'cancelled' }] } })),
];

describe('structured public heads', () => {
  it.each(heads)('has equal display content on live end and supplied history: $title', (presentation) => {
    let messages: MobileTranscriptMessage[] = [];
    const push = (event: Parameters<typeof handleRemotePush>[0]): void => {
      handleRemotePush(event, { current: 's1' }, (update) => { messages = typeof update === 'function' ? update(messages) : update; }, () => undefined, () => undefined);
    };
    push({ type: 'event', sessionId: 's1', event: { type: 'message/start', messageId: 'm1', role: 'assistant' } });
    push({ type: 'event', sessionId: 's1', event: { type: 'tool/start', toolCallId: 't1', toolName: presentation.title, responseMessageId: 'm1', presentation } });
    push({ type: 'event', sessionId: 's1', event: { type: 'tool/end', toolCallId: 't1', responseMessageId: 'm1', isError: false, presentation } });
    const live = messages[0]?.toolCalls?.[0];
    const history = readSessionMessages({ success: true, data: { messages: [{ id: 'm1', role: 'assistant', text: '', status: 'done', createdAt: '2026-10-02', tools: [{ toolCallId: 't1', toolName: presentation.title, status: 'done', presentation }] }] } })[0]?.toolCalls?.[0];
    if (live === undefined || history === undefined) throw new Error('Missing tool fixture');
    expect(projectToolRow(live)).toEqual(projectToolRow(history));
    expect(projectToolRow(live).structured ?? projectToolRow(live).subagent).toBeDefined();
  });

  it('shows exact loop refs and a failed verification, not delivery after application', () => {
    const rows = heads.slice(3, 8).map((presentation) => projectToolRow({ id: 't1', name: presentation.title, status: 'done', presentation }));
    const text = JSON.stringify(rows);
    expect(text).toContain('result-1 · r2');
    expect(text).toContain('review-1 · r3');
    expect(text).toContain('verification-1 · r4');
    expect(text).toContain('op-1');
    expect(rows[2]?.structured?.summary).toBe('applied');
    expect(rows[4]?.structured?.summary).toBe('failed');
    expect(rows[4]?.status).toBe('fail');
    expect(text).not.toContain('delivered');
  });

  it('omits optional Goal evidence/duration and run lifecycle rather than inventing zeros or success', () => {
    const row = projectToolRow({ id: 't1', name: 'goal_wait', status: 'done', presentation: { kind: 'other', title: 'wait', goal: { phase: 'waited', reason: 'External job' } } });
    expect(row.structured?.fields).toEqual([]);
    const completed = projectToolRow({ id: 't1', name: 'goal_complete', status: 'done', presentation: { kind: 'other', title: 'goal', goal: { phase: 'completed', summary: 'Offered summary' } } });
    expect(completed.structured?.fields).toEqual([]);
  });

  it.each([null, [], { phase: 'unknown', reason: 'secret' }, { phase: 'completed', summary: {} }])('falls back for malformed Goal %j', (goal) => {
    const tool = { id: 't1', name: 'mystery', status: 'done', presentation: { kind: 'other', title: 'mystery', goal } } as unknown as MobileToolCall;
    expect(projectToolRow(tool).structured).toBeUndefined();
  });

  it('rejects missing loop status and malformed control discriminants/counters', () => {
    for (const presentation of [
      { subagentLoop: { kind: 'verification-submit', result, verificationRef: { verificationId: 'v1', revision: 1 } } },
      { subagentControl: { phase: 'other', runs: [] } },
      { subagentControl: { phase: 'waited', total: NaN, completed: 0, failed: 0, cancelled: 0, needsIntegration: 0, runs: [] } },
    ]) {
      const row = projectToolRow({ id: 't1', name: 'mystery', status: 'done', presentation: { kind: 'other', title: 'mystery', ...presentation } } as unknown as MobileToolCall);
      expect(row.structured).toBeUndefined();
      expect(row.subagent).toBeUndefined();
    }
  });
});

describe('formatting helpers', () => {
  it('formats durations for the meta column', () => {
    expect(formatToolDuration(40)).toBe('40ms');
    expect(formatToolDuration(4100)).toBe('4.1s');
    expect(formatToolDuration(42_000)).toBe('42s');
    expect(formatToolDuration(63_000)).toBe('1m 3s');
  });

  it('keeps the basename visible when shortening paths', () => {
    expect(shortenPath('packages/session/src/deeply/nested/folder/session-index.ts')).toBe(
      '…/folder/session-index.ts',
    );
    expect(shortenPath('a.ts')).toBe('a.ts');
  });

  it('reads escaped prompts', () => {
    expect(readQuestionPrompt('{"prompt":"say \\"hi\\""}')).toBe('say "hi"');
    expect(readQuestionPrompt(undefined)).toBeUndefined();
  });
});
