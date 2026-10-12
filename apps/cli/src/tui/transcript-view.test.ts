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
