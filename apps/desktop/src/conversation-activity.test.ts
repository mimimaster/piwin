import { describe, expect, it } from 'vitest';
import {
  conversationActivityLabel,
  resolveConversationActivityKind,
} from './conversation-activity.js';
import type { ToolCardUi } from './chat-reducer.js';

function runningTool(toolName: string, extras: Partial<ToolCardUi> = {}): ToolCardUi {
  return {
    toolCallId: `tc-${toolName}`,
    toolName,
    status: 'running',
    output: '',
    ...extras,
  };
}

describe('conversation activity', () => {
  it('maps stopping, search, and generation without exposing tool names', () => {
    expect(resolveConversationActivityKind({ runState: { kind: 'stopping' } })).toBe('stopping');
    expect(
      resolveConversationActivityKind({
        streaming: true,
        tools: [runningTool('web_search')],
      }),
    ).toBe('searching');
    expect(
      resolveConversationActivityKind({
        streaming: true,
        tools: [runningTool('piwin_toolbox', { presentation: { kind: 'image', title: 'Image' } })],
      }),
    ).toBe('generating-image');
    expect(
      resolveConversationActivityKind({
        streaming: true,
        tools: [runningTool('video_gen')],
      }),
    ).toBe('generating-video');
    expect(resolveConversationActivityKind({ streaming: true, tools: [] })).toBe('thinking');
    expect(conversationActivityLabel('thinking', 'en')).toBe('Thinking…');
    expect(conversationActivityLabel('searching', 'en')).not.toContain('web_search');
  });
});
