import { describe, expect, it } from 'vitest';
import type { TranscriptMessageEntry, TranscriptState } from './transcript-model.js';
import { TranscriptView } from './transcript-view.js';

const ANSI = /\x1b\[[0-9;]*m/g;

function assistantWithThinking(lineCount: number): TranscriptState {
  const entry: TranscriptMessageEntry = {
    kind: 'message',
    id: 'a1',
    role: 'assistant',
    text: '结论在这里',
    thinking: Array.from({ length: lineCount }, (_, index) => `第 ${index + 1} 步思考`).join('\n'),
    status: 'done',
    tools: [],
  };
  return { entries: [entry], noticeCount: 0 };
}

function render(view: TranscriptView): string {
  return view
    .render(80)
    .map((line) => line.replace(ANSI, ''))
    .join('\n');
}

describe('TranscriptView thinking', () => {
  it('keeps a short reasoning whole', () => {
    const view = new TranscriptView();
    view.setState(assistantWithThinking(3));
    const text = render(view);
    expect(text).toContain('第 1 步思考');
    expect(text).not.toContain('已折叠');
  });

  it('folds a long reasoning to its last lines and says how to see the rest', () => {
    const view = new TranscriptView();
    view.setState(assistantWithThinking(20));
    const text = render(view);
    expect(text).toContain('前 16 行思考已折叠 · Ctrl+O 展开');
    expect(text).toContain('第 20 步思考');
    expect(text).not.toContain('第 1 步思考');
    expect(text).toContain('结论在这里');
  });

  it('shows all of it once expanded', () => {
    const view = new TranscriptView();
    view.setState(assistantWithThinking(20));
    view.toggleToolOutput();
    const text = render(view);
    expect(text).toContain('第 1 步思考');
    expect(text).not.toContain('已折叠');
  });
});

describe('TranscriptView artifacts', () => {
  it('folds a finished artifact into a card instead of printing its source', () => {
    const view = new TranscriptView();
    const state = assistantWithThinking(0);
    const entry = state.entries[0] as TranscriptMessageEntry;
    const fence = '```';
    view.setState({
      ...state,
      entries: [{ ...entry, text: `看这个：\n${fence}artifact-html title="计数器"\n<p>secret-body</p>\n${fence}\n完毕` }],
    });
    const text = render(view);
    expect(text).toContain('◆ 计数器 · HTML · 18 B');
    expect(text).toContain('o 打开 · s 源码 · w 保存 · c 复制');
    expect(text).toContain('看这个');
    expect(text).toContain('完毕');
    expect(text).not.toContain('secret-body');
  });
});

describe('TranscriptView edit diffs', () => {
  it('shows the diff under an edit tool, folded until tool output is expanded', () => {
    const view = new TranscriptView();
    const state = assistantWithThinking(0);
    const entry = state.entries[0] as TranscriptMessageEntry;
    const patch = `@@ -1 +1,9 @@\n-a\n${Array.from({ length: 9 }, (_, index) => `+b${index}`).join('\n')}\n`;
    view.setState({
      ...state,
      entries: [
        {
          ...entry,
          tools: [
            {
              toolCallId: 't1',
              toolName: 'edit',
              status: 'done',
              output: '',
              presentation: {
                kind: 'filesystem',
                title: 'Edit',
                fileChange: { path: 'x.ts', status: 'modified', additions: 9, deletions: 1, binary: false, patch },
              },
            },
          ],
        },
      ],
    });
    const folded = render(view);
    expect(folded).toContain('修改 x.ts +9 −1');
    expect(folded).toContain('还有 5 行 · Ctrl+O 展开');
    expect(folded).not.toContain('+b8');
    view.toggleToolOutput();
    view.invalidate();
    expect(render(view)).toContain('+b8');
  });
});

describe('TranscriptView subagent delegations', () => {
  const T0 = Date.now() - 5_000;
  const started = (id: string, task: string) => ({
    toolCallId: `call-${id}`,
    toolName: 'piwin_subagent_start',
    status: 'done' as const,
    output: 'accepted',
    presentation: {
      kind: 'subagent' as const,
      title: 'piwin_subagent_start',
      subagentControl: { phase: 'accepted' as const, runId: `run-${id}`, invocationId: `inv-${id}`, task },
    },
  });
  const state = (tools: TranscriptMessageEntry['tools']): TranscriptState => ({
    entries: [{ kind: 'message', id: 'a1', role: 'assistant', text: '', thinking: '', status: 'done', tools }],
    noticeCount: 0,
  });

  it('draws two or more delegations in a row as one fan-out instead of separate tool lines', () => {
    const view = new TranscriptView();
    view.setState(state([started('a', '实现导出接口'), started('b', '审查权限改动')]));
    view.setSubagentRuns(
      (invocationId) =>
        invocationId === 'inv-a'
          ? { invocationId: 'inv-a', runId: 'run-a', task: '实现导出接口', title: '实现导出接口', status: 'running', activity: '思考中', step: 'read src/a.ts', startedAt: T0 }
          : undefined,
      1,
    );
    const text = render(view);
    expect(text).toContain('派出 2 个子代理');
    expect(text).toMatch(/主代理 ──┬─ ◌ 实现导出接口 +read src\/a\.ts/);
    expect(text).toMatch(/└─ · 审查权限改动 +已派出/);
    expect(text).not.toContain('piwin_subagent_start');
  });

  it('keeps a lone synchronous run as its tool line with a live row under it', () => {
    const view = new TranscriptView();
    view.setState(
      state([
        {
          toolCallId: 'call-sync',
          toolName: 'piwin_subagent_run',
          status: 'running',
          output: '',
          presentation: { kind: 'subagent', title: '子代理', summary: '审查权限改动' },
        },
      ]),
    );
    view.setSubagentRuns(
      () => undefined,
      1,
      (toolCallId) =>
        toolCallId === 'call-sync'
          ? { invocationId: 'i', runId: 'r', task: '审查权限改动', status: 'running', activity: '思考中', step: 'grep allow(', startedAt: T0 }
          : undefined,
    );
    const text = render(view);
    expect(text).not.toContain('派出');
    expect(text).toMatch(/└ ◌ 审查权限改动 grep allow\(/);
  });
});
