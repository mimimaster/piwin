import type { AgentEvent } from '@piwin/contracts';
import { describe, expect, it } from 'vitest';
import { createChatOutput, parseOutputFormat } from './chat-output.js';

const events = (): AgentEvent[] =>
  [
    { type: 'message/start', messageId: 'a1', role: 'assistant' },
    { type: 'message/text_delta', messageId: 'a1', delta: '你好' },
    { type: 'message/text_delta', messageId: 'a1', delta: '，世界' },
    { type: 'usage/update', sessionId: 's1', usage: { sessionId: 's1', totalTokens: 42 } },
    { type: 'message/end', messageId: 'a1' },
  ] as unknown as AgentEvent[];

function run(format: 'text' | 'json' | 'stream-json', feed: AgentEvent[] = events()) {
  const written: string[] = [];
  const output = createChatOutput(format, (data) => written.push(data));
  for (const event of feed) output.event(event);
  output.finish({ sessionId: 's1', runId: 'r1' });
  return { written, output };
}

describe('createChatOutput', () => {
  it('json prints one result and nothing else', () => {
    const { written } = run('json');
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0] ?? '')).toEqual({
      type: 'result',
      sessionId: 's1',
      runId: 'r1',
      isError: false,
      text: '你好，世界',
      usage: { sessionId: 's1', totalTokens: 42 },
    });
  });

  it('stream-json prints every event as a line, then the result', () => {
    const { written } = run('stream-json');
    const lines = written.join('').trim().split('\n').map((line) => JSON.parse(line) as { type: string; event?: AgentEvent });
    expect(lines.slice(0, -1).map((line) => line.event?.type)).toEqual([
      'message/start',
      'message/text_delta',
      'message/text_delta',
      'usage/update',
      'message/end',
    ]);
    expect(lines.at(-1)).toMatchObject({ type: 'result', text: '你好，世界' });
  });

  it('keeps only the last message as the answer', () => {
    const { written } = run('json', [
      ...events(),
      { type: 'message/start', messageId: 'a2', role: 'assistant' },
      { type: 'message/text_delta', messageId: 'a2', delta: '最后一条' },
    ] as unknown as AgentEvent[]);
    expect(JSON.parse(written[0] ?? '')).toMatchObject({ text: '最后一条' });
  });

  it('marks the result as an error once an error event was seen', () => {
    const { written, output } = run('json', [{ type: 'error', message: 'boom' }] as unknown as AgentEvent[]);
    expect(JSON.parse(written[0] ?? '')).toMatchObject({ isError: true });
    expect(output.failed).toBe(true);
  });

  it('text keeps the human stream and ends with a newline', () => {
    const { written } = run('text');
    expect(written.join('')).toContain('你好，世界');
    expect(written.at(-1)).toBe('\n');
    expect(written.join('')).not.toContain('"type"');
  });
});

describe('parseOutputFormat', () => {
  it('defaults to text and rejects unknown formats', () => {
    expect(parseOutputFormat(['chat', 'x'])).toBe('text');
    expect(parseOutputFormat(['chat', '--output-format', 'stream-json'])).toBe('stream-json');
    expect(parseOutputFormat(['chat', '--output-format', 'xml'])).toEqual({
      error: '--output-format must be one of text, json, stream-json',
    });
    expect(parseOutputFormat(['chat', '--output-format'])).toMatchObject({ error: expect.any(String) });
  });
});
