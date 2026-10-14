import { describe, expect, it } from 'vitest';
import type { SessionSummary, SubagentInvocation } from '@piwin/contracts';
import {
  deriveSubagentPreview,
  formatPreviewOffset,
  type SubagentPreviewInput,
  type SubagentStepMessage,
  type SubagentStepTail,
  type SubagentStepTool,
} from './subagent-preview-projection.js';

const START = '2026-10-14T10:00:00.000Z';

function invocation(overrides: Partial<SubagentInvocation> = {}): SubagentInvocation {
  return {
    id: 'inv-1',
    parentSessionId: 'parent',
    runId: 'run-1',
    taskId: 'task-1',
    task: '查找 token 刷新的所有调用点',
    childSessionId: 'child-1',
    status: 'running',
    activity: { kind: 'thinking' },
    revision: 1,
    createdAt: START,
    updatedAt: '2026-10-14T10:01:12.000Z',
    ...overrides,
  };
}

function tool(overrides: Partial<SubagentStepTool> & Pick<SubagentStepTool, 'toolCallId'>): SubagentStepTool {
  return { toolName: 'read', status: 'done', ...overrides };
}

function assistant(id: string, parts: Partial<SubagentStepMessage>): SubagentStepMessage {
  return { id, role: 'assistant', text: '', thinking: '', tools: [], ...parts };
}

function input(overrides: Partial<SubagentPreviewInput> = {}): SubagentPreviewInput {
  return {
    status: 'running',
    messages: [],
    liveTail: null,
    invocation: invocation(),
    showThinking: false,
    locale: 'zh-CN',
    ...overrides,
  };
}

describe('formatPreviewOffset', () => {
  it('formats m:ss from the child start and hides unknown ends', () => {
    expect(formatPreviewOffset(Date.parse(START), '2026-10-14T10:01:05.900Z')).toBe('1:05');
    expect(formatPreviewOffset(Date.parse(START), undefined)).toBe('');
    expect(formatPreviewOffset(Number.NaN, START)).toBe('');
  });
});

describe('deriveSubagentPreview', () => {
  it('turns each tool call into one verb/target/result line', () => {
    const view = deriveSubagentPreview(
      input({
        child: { workingDirectory: '/repo' } as SessionSummary,
        messages: [
          assistant('m1', {
            text: '先看刷新逻辑。\n第二行不显示',
            tools: [
              tool({
                toolCallId: 't1',
                presentation: {
                  kind: 'filesystem',
                  title: 'Read',
                  targetPaths: ['/repo/packages/auth/refresh.ts'],
                  lineRange: '1-40',
                  startedAt: '2026-10-14T10:00:03.000Z',
                },
              }),
              tool({
                toolCallId: 't2',
                toolName: 'bash',
                status: 'error',
                presentation: { kind: 'shell', title: 'Bash', command: 'rg token\n| head', exitCode: 2 },
              }),
              tool({
                toolCallId: 't3',
                toolName: 'grep',
                presentation: { kind: 'filesystem', title: 'Grep', inputPreview: 'refreshToken(', countTag: '12 处' },
              }),
            ],
          }),
        ],
      }),
    );
    expect(view.lines).toEqual([
      { kind: 'say', key: 'm1:say', offset: '', text: '先看刷新逻辑。' },
      {
        kind: 'tool',
        key: 't1',
        offset: '0:03',
        verb: 'read',
        target: 'packages/auth/refresh.ts:1-40',
        result: '',
        status: 'done',
      },
      { kind: 'tool', key: 't2', offset: '', verb: 'bash', target: 'rg token', result: 'exit 2', status: 'error' },
      { kind: 'tool', key: 't3', offset: '', verb: 'grep', target: 'refreshToken(', result: '12 处', status: 'done' },
    ]);
  });

  it('shows thinking only when the preference allows it', () => {
    const messages = [assistant('m1', { thinking: '需要确认 retry\n细节' })];
    expect(deriveSubagentPreview(input({ messages })).lines).toEqual([]);
    expect(deriveSubagentPreview(input({ messages, showThinking: true })).lines).toEqual([
      { kind: 'think', key: 'm1:think', offset: '', text: '需要确认 retry' },
    ]);
  });

  it('appends the live tail and skips user/system messages', () => {
    const liveTail: SubagentStepTail = {
      id: 'm2',
      text: '正在核对',
      thinking: '',
      tools: [{ toolCallId: 'live-1', toolName: 'read', status: 'running' }],
    };
    const view = deriveSubagentPreview(
      input({
        liveTail,
        messages: [{ ...assistant('u1', { text: 'task prompt' }), role: 'user' }],
      }),
    );
    expect(view.lines.map((line) => line.key)).toEqual(['m2:say', 'live-1']);
    expect(view.live).toBe(true);
    expect(view.endedAt).toBeUndefined();
  });

  it('keeps the most recent lines and counts the elided ones', () => {
    const tools = Array.from({ length: 5 }, (_, index) => tool({ toolCallId: `t${index}` }));
    const view = deriveSubagentPreview(input({ messages: [assistant('m1', { tools })], maxLines: 3 }));
    expect(view.elidedCount).toBe(2);
    expect(view.lines.map((line) => line.key)).toEqual(['t2', 't3', 't4']);
  });

  it('uses the full final message as the result, without a success verdict', () => {
    const view = deriveSubagentPreview(
      input({
        status: 'completed',
        invocation: invocation({ status: 'completed', activity: { kind: 'completed', summary: '短摘要' } }),
        messages: [assistant('m1', { text: 'complete\n- 7 处调用\n- 2 处直连' })],
      }),
    );
    expect(view.outcome).toEqual({ tone: 'done', label: '结论', text: '7 处调用\n- 2 处直连' });
    expect(view.endedAt).toBe('2026-10-14T10:01:12.000Z');
  });

  it('falls back to the Host summary before history loads', () => {
    const view = deriveSubagentPreview(
      input({
        status: 'completed',
        invocation: invocation({ status: 'completed', activity: { kind: 'completed', summary: '短摘要' } }),
      }),
    );
    expect(view.outcome?.text).toBe('短摘要');
  });

  it('reports failures and nothing for running or cancelled children', () => {
    const failed = deriveSubagentPreview(
      input({
        status: 'failed',
        invocation: invocation({ status: 'failed', activity: { kind: 'failed', message: 'provider 429' } }),
      }),
    );
    expect(failed.outcome).toEqual({ tone: 'failed', label: '失败', text: 'provider 429' });
    expect(deriveSubagentPreview(input()).outcome).toBeUndefined();
    expect(deriveSubagentPreview(input({ status: 'cancelled' })).outcome).toBeUndefined();
  });

  it('lists only the meta fields the Host sent', () => {
    expect(deriveSubagentPreview(input()).meta).toEqual([]);
    expect(
      deriveSubagentPreview(
        input({ invocation: invocation({ model: { protocol: 'anthropic-compatible', providerId: 'a', modelId: 'raw-id' } }) }),
      ).meta,
    ).toEqual(['raw-id']);
    expect(
      deriveSubagentPreview(
        input({
          modelLabel: 'Opus',
          invocation: invocation({ model: { protocol: 'anthropic-compatible', providerId: 'a', modelId: 'raw-id' } }),
        }),
      ).meta,
    ).toEqual(['Opus']);
    const view = deriveSubagentPreview(
      input({
        invocation: invocation({
          role: 'scout',
          usage: { toolCalls: 14, totalTokens: 31_000, requests: 3 },
        }),
      }),
    );
    expect(view.meta).toEqual(['scout', '14 次工具调用', '31k tok']);
    expect(view.task).toBe('查找 token 刷新的所有调用点');
    expect(view.statusLabel).toBe('运行中');
  });
});
