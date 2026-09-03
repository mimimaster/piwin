import { describe, expect, it } from 'vitest';
import {
  createToolArgProgressAccumulator,
  readAssistantToolArgProgress,
  rewriteCumulativeToolArgProgress,
} from './assistant-tool-arg-progress.js';

describe('readAssistantToolArgProgress', () => {
  it('reads toolcall_delta argument characters without exposing the body', () => {
    expect(
      readAssistantToolArgProgress({
        type: 'toolcall_delta',
        name: 'write_file',
        delta: '{"path":"docs/a.html","content":"<html>',
      }),
    ).toEqual({
      kind: 'delta',
      chars: '{"path":"docs/a.html","content":"<html>'.length,
      toolName: 'write_file',
    });
  });

  it('treats arguments snapshots as replacements', () => {
    expect(
      readAssistantToolArgProgress({
        type: 'tool_call',
        toolName: 'read',
        arguments: { path: 'README.md' },
      }),
    ).toEqual({
      kind: 'snapshot',
      chars: JSON.stringify({ path: 'README.md' }).length,
      toolName: 'read',
    });
  });

  it('ignores thinking and text updates', () => {
    expect(readAssistantToolArgProgress({ type: 'thinking_delta', delta: 'plan' })).toBeNull();
    expect(readAssistantToolArgProgress({ type: 'text_delta', delta: 'hi' })).toBeNull();
  });
});

describe('rewriteCumulativeToolArgProgress', () => {
  it('accumulates deltas and keeps the last known tool name', () => {
    const accumulator = createToolArgProgressAccumulator();
    const first = rewriteCumulativeToolArgProgress(
      {
        type: 'message/tool_args_progress',
        messageId: 'm1',
        argumentCharCount: 10,
        toolName: 'write_file',
      },
      { kind: 'delta', chars: 10, toolName: 'write_file' },
      accumulator,
    );
    const second = rewriteCumulativeToolArgProgress(
      {
        type: 'message/tool_args_progress',
        messageId: 'm1',
        argumentCharCount: 7,
      },
      { kind: 'delta', chars: 7 },
      accumulator,
    );
    expect(first.argumentCharCount).toBe(10);
    expect(second).toEqual({
      type: 'message/tool_args_progress',
      messageId: 'm1',
      argumentCharCount: 17,
      toolName: 'write_file',
    });
  });
});
