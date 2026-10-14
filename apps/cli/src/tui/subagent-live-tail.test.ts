import type { AgentEvent } from '@piwin/contracts';
import { describe, expect, it } from 'vitest';
import {
  applySubagentStreamEvent,
  EMPTY_SUBAGENT_TAIL,
  runningSubagentTool,
  subagentTailForPreview,
  type SubagentLiveTail,
} from './subagent-live-tail.js';

function fold(events: AgentEvent[], from: SubagentLiveTail = EMPTY_SUBAGENT_TAIL): SubagentLiveTail {
  return events.reduce(applySubagentStreamEvent, from);
}

describe('subagent live tail', () => {
  it('follows one message: text, tool start and end, then counts it finished', () => {
    const tail = fold([
      { type: 'message/start', messageId: 'm1', role: 'assistant' },
      { type: 'message/text_delta', messageId: 'm1', delta: '先看' },
      { type: 'message/text_delta', messageId: 'm1', delta: '刷新逻辑' },
      { type: 'tool/start', toolCallId: 't1', toolName: 'read' },
      { type: 'tool/start', toolCallId: 't2', toolName: 'bash' },
      { type: 'tool/end', toolCallId: 't1', isError: false },
    ]);
    expect(tail.text).toBe('先看刷新逻辑');
    expect(tail.tools.map((tool) => [tool.toolCallId, tool.status])).toEqual([
      ['t1', 'done'],
      ['t2', 'running'],
    ]);
    expect(runningSubagentTool(tail)?.toolCallId).toBe('t2');
    const ended = fold([{ type: 'tool/end', toolCallId: 't2', isError: true }, { type: 'message/end', messageId: 'm1' }], tail);
    expect(ended.tools[1]?.status).toBe('error');
    expect(ended.completedMessages).toBe(1);
    expect(runningSubagentTool(ended)).toBeUndefined();
  });

  it('starts over on the next assistant message, not on a user one', () => {
    const first = fold([
      { type: 'message/start', messageId: 'm1', role: 'assistant' },
      { type: 'tool/start', toolCallId: 't1', toolName: 'read' },
    ]);
    expect(fold([{ type: 'message/start', messageId: 'u1', role: 'user' }], first)).toBe(first);
    const second = fold([{ type: 'message/start', messageId: 'm2', role: 'assistant' }], first);
    expect(second).toMatchObject({ messageId: 'm2', text: '', tools: [] });
  });

  it('holds a pending permission until that request is resolved', () => {
    const asked = fold([
      { type: 'permission/request', requestId: 'p1', action: 'bash', detail: 'rm -rf dist', defaultDecision: 'ask' },
    ]);
    expect(asked.permission).toEqual({ requestId: 'p1', action: 'bash', detail: 'rm -rf dist' });
    expect(fold([{ type: 'permission/resolved', requestId: 'other', decision: 'allow' }], asked)).toBe(asked);
    expect(fold([{ type: 'permission/resolved', requestId: 'p1', decision: 'deny' }], asked).permission).toBeNull();
  });

  it('returns the same object for events it does not use', () => {
    expect(applySubagentStreamEvent(EMPTY_SUBAGENT_TAIL, { type: 'tool/update', toolCallId: 't', delta: 'x' })).toBe(
      EMPTY_SUBAGENT_TAIL,
    );
  });

  it('hands the preview a tail only while history lacks the current message', () => {
    const tail = fold([
      { type: 'message/start', messageId: 'm1', role: 'assistant' },
      { type: 'message/text_delta', messageId: 'm1', delta: 'hi' },
    ]);
    expect(subagentTailForPreview(tail, new Set())).toEqual({ id: 'm1', text: 'hi', thinking: '', tools: [] });
    expect(subagentTailForPreview(tail, new Set(['m1']))).toBeNull();
    expect(subagentTailForPreview(EMPTY_SUBAGENT_TAIL, new Set())).toBeNull();
  });
});
