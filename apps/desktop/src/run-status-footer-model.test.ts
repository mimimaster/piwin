import { describe, expect, it } from 'vitest';
import type { ChatMessageUi, RunRecordUi } from './chat-reducer';
import {
  estimateRunOutputTokens,
  estimateTextTokens,
  resolveRunStatusActivityInput,
  resolveRunStatusStartedAt,
} from './run-status-footer-model';

function assistant(overrides: Partial<ChatMessageUi>): ChatMessageUi {
  return {
    id: 'a1',
    role: 'assistant',
    text: '',
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
    runId: 'r1',
    ...overrides,
  };
}

function runs(phase: RunRecordUi['phaseHistory'][number]['phase'], startedAt: number | null = 1_000) {
  return { r1: { runId: 'r1', phaseHistory: [{ phase, at: 5 }], startedAt, endedAt: null } };
}

describe('estimateTextTokens', () => {
  it('counts dense scripts per char and latin text per four chars', () => {
    expect(estimateTextTokens('')).toBe(0);
    expect(estimateTextTokens('abcdefgh')).toBe(2);
    expect(estimateTextTokens('解析上下文')).toBe(5);
    expect(estimateTextTokens('读取 file')).toBe(2 + 2);
  });
});

describe('estimateRunOutputTokens', () => {
  it('sums text, reasoning, live arg progress and tool previews of the active run only', () => {
    const messages: ChatMessageUi[] = [
      { ...assistant({ id: 'old', runId: 'r0', text: 'x'.repeat(400) }) },
      { id: 'u1', role: 'user', text: 'hi', thinking: '', tools: [], attachments: [], status: 'done' },
      assistant({
        text: 'a'.repeat(40),
        thinking: 'b'.repeat(40),
        tools: [
          {
            toolCallId: 't1',
            toolName: 'bash',
            status: 'done',
            output: 'ignored output '.repeat(50),
            presentation: { kind: 'shell', title: 'bash', inputPreview: 'c'.repeat(40) },
          },
        ],
      }),
      assistant({ id: 'a2', status: 'streaming', toolArgsProgress: { argumentCharCount: 4_000 } }),
    ];
    expect(estimateRunOutputTokens(messages, 'r1')).toBe(10 + 10 + 10 + 1_000);
  });
});

describe('resolveRunStatusActivityInput', () => {
  const base = { activeRunId: 'r1', modelWaitTail: null, locale: 'zh-CN' as const };

  it('describes the running tool with its host detail', () => {
    const input = resolveRunStatusActivityInput({
      ...base,
      runRecordsById: runs('tool-running'),
      messages: [
        assistant({
          tools: [
            {
              toolCallId: 't1',
              toolName: 'bash',
              status: 'running',
              output: '',
              presentation: { kind: 'shell', title: 'bash', command: 'pnpm test' },
            },
          ],
        }),
      ],
    });
    expect(input).toMatchObject({ kind: 'working', activeToolName: 'bash', detail: 'pnpm test' });
  });

  it('reads model streaming without a tool as the thinking bank', () => {
    const input = resolveRunStatusActivityInput({
      ...base,
      runRecordsById: runs('streaming'),
      messages: [assistant({ status: 'streaming', thinking: 'hmm' })],
    });
    expect(input.kind).toBe('waiting-first-token');
  });

  it('follows the model-wait tail, including provider retries', () => {
    const input = resolveRunStatusActivityInput({
      ...base,
      runRecordsById: runs('connecting-model'),
      messages: [],
      modelWaitTail: { kind: 'reconnecting', placeholderMessageIds: [] },
    });
    expect(input.kind).toBe('connecting-model');
  });

  it('keeps preparing and connecting phases before the first message', () => {
    expect(
      resolveRunStatusActivityInput({ ...base, runRecordsById: runs('preparing'), messages: [] }).kind,
    ).toBe('preparing');
    expect(
      resolveRunStatusActivityInput({ ...base, activeRunId: null, runRecordsById: {}, messages: [] }).kind,
    ).toBe('connecting-model');
  });
});

describe('resolveRunStatusStartedAt', () => {
  it('prefers the Host run start and falls back to the user message time', () => {
    const user: ChatMessageUi = {
      id: 'u1',
      role: 'user',
      text: 'hi',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
      createdAt: '2026-09-15T08:00:00.000Z',
    };
    expect(resolveRunStatusStartedAt({ messages: [user], activeRunId: 'r1', runRecordsById: runs('preparing') })).toBe(1_000);
    expect(
      resolveRunStatusStartedAt({ messages: [user], activeRunId: 'r1', runRecordsById: runs('preparing', null) }),
    ).toBe(Date.parse('2026-09-15T08:00:00.000Z'));
    expect(resolveRunStatusStartedAt({ messages: [], activeRunId: null, runRecordsById: {} })).toBeUndefined();
  });
});
