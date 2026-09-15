import { describe, expect, it } from 'vitest';
import type { ChatMessageUi, RunRecordUi, ToolCardUi } from './chat-reducer';
import { resolveModelWaitTail } from './model-wait-tail';
import { modelWaitTailLabel } from './model-wait-tail-row';

function tool(status: ToolCardUi['status']): ToolCardUi {
  return {
    toolCallId: `t-${status}`,
    toolName: 'piwin_toolbox',
    status,
    output: '',
    presentation: { kind: 'mcp', title: 'toolbox', endedAt: '2026-09-15T00:00:10.000Z' },
  };
}

function assistant(partial: Partial<ChatMessageUi> & Pick<ChatMessageUi, 'id'>): ChatMessageUi {
  return {
    role: 'assistant',
    text: '',
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
    runId: 'r1',
    model: { providerId: 'google', modelId: 'gemini-3.8-flash' },
    ...partial,
  };
}

function runs(phase: string | null, detail?: string): Record<string, RunRecordUi> {
  return {
    r1: {
      runId: 'r1',
      phaseHistory:
        phase === null
          ? []
          : [{ phase: phase as RunRecordUi['phaseHistory'][number]['phase'], at: 42_000, ...(detail ? { detail } : {}) }],
      startedAt: 1,
      endedAt: null,
    },
  };
}

const base = { streaming: true, activeRunId: 'r1', permissionPending: false };

describe('resolveModelWaitTail', () => {
  it('appears once the tool round settles and Host waits for the next token', () => {
    const tail = resolveModelWaitTail({
      ...base,
      messages: [assistant({ id: 'a1', tools: [tool('done')] })],
      runRecordsById: runs('waiting-first-token'),
    });
    expect(tail).toMatchObject({ kind: 'waiting', since: 42_000, placeholderMessageIds: [] });
    expect(tail && modelWaitTailLabel(tail, 'zh-CN')).toMatch(/正在处理结果…$/);
  });

  it('stands in for empty message/start placeholders after the round', () => {
    const tail = resolveModelWaitTail({
      ...base,
      messages: [
        assistant({ id: 'a1', tools: [tool('done')] }),
        assistant({ id: 'a2', status: 'streaming' }),
      ],
      runRecordsById: runs('waiting-first-token'),
    });
    expect(tail?.placeholderMessageIds).toEqual(['a2']);
  });

  it('reports provider retries as reconnecting', () => {
    const tail = resolveModelWaitTail({
      ...base,
      messages: [assistant({ id: 'a1', tools: [tool('done')] })],
      runRecordsById: runs('connecting-model', 'attempt 2/3'),
    });
    expect(tail && modelWaitTailLabel(tail, 'zh-CN')).toBe('正在重连模型 · attempt 2/3');
  });

  it('stays away while tools run, tokens stream, permission blocks, or the run is idle', () => {
    const settled = [assistant({ id: 'a1', tools: [tool('done')] })];
    expect(
      resolveModelWaitTail({
        ...base,
        messages: [assistant({ id: 'a1', tools: [tool('running')] })],
        runRecordsById: runs('tool-running'),
      }),
    ).toBeNull();
    expect(
      resolveModelWaitTail({ ...base, messages: settled, runRecordsById: runs('streaming') }),
    ).toBeNull();
    expect(
      resolveModelWaitTail({
        ...base,
        permissionPending: true,
        messages: settled,
        runRecordsById: runs('waiting-first-token'),
      }),
    ).toBeNull();
    expect(
      resolveModelWaitTail({
        ...base,
        streaming: false,
        messages: settled,
        runRecordsById: runs('waiting-first-token'),
      }),
    ).toBeNull();
    expect(
      resolveModelWaitTail({
        ...base,
        messages: [assistant({ id: 'a1', text: 'answer', status: 'streaming' })],
        runRecordsById: runs('waiting-first-token'),
      }),
    ).toBeNull();
  });

  it('falls back to the last tool end time without phase history', () => {
    const tail = resolveModelWaitTail({
      ...base,
      messages: [assistant({ id: 'a1', tools: [tool('done')] })],
      runRecordsById: runs(null),
    });
    expect(tail?.since).toBe(Date.parse('2026-09-15T00:00:10.000Z'));
  });
});
