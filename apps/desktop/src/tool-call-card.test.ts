import { describe, expect, it } from 'vitest';
import { collectSessionTools } from './tool-call-card';
import type { ToolCardUi } from './chat-reducer';

describe('collectSessionTools', () => {
  it('flattens tools from all messages in order', () => {
    const first: ToolCardUi = {
      toolCallId: 'a',
      toolName: 'bash',
      status: 'done',
      output: 'ok',
    };
    const second: ToolCardUi = {
      toolCallId: 'b',
      toolName: 'read',
      status: 'running',
      output: '',
    };
    const tools = collectSessionTools([
      { tools: [first] },
      { tools: [] },
      { tools: [second] },
    ]);
    expect(tools).toEqual([first, second]);
  });
});
