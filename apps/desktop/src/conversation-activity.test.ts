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
    expect(
      resolveConversationActivityKind({
        streaming: true,
        tools: [runningTool('flashcard_create')],
      }),
    ).toBe('creating-flashcard');
    expect(
      resolveConversationActivityKind({
        streaming: true,
        tools: [runningTool('create_artifact')],
      }),
    ).toBe('generating-artifact');
    expect(
      resolveConversationActivityKind({
        streaming: true,
        tools: [runningTool('custom_calculator')],
      }),
    ).toBe('calling-tool');
    expect(resolveConversationActivityKind({ streaming: true, tools: [] })).toBe('thinking');
    expect(conversationActivityLabel('thinking', 'en')).toBe('Thinking…');
    expect(conversationActivityLabel('creating-flashcard', 'zh-CN')).toBe('正在创建知识卡片…');
    expect(conversationActivityLabel('creating-flashcard', 'en')).toBe('Creating flashcard…');
    expect(conversationActivityLabel('calling-tool', 'zh-CN')).toBe('正在调用工具…');
    expect(conversationActivityLabel('searching', 'en')).not.toContain('web_search');
  });
});
