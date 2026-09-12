/**
 * Human-readable Conversation activity. No tool names, args, or Agent verbs.
 */
import type { ToolCardUi } from './chat-reducer';
import { resolveGenerationToolKind } from './generation-tool-kind.js';
import type { RunStatusView } from './run-status.js';

export type ConversationActivityKind =
  | 'thinking'
  | 'searching'
  | 'generating-image'
  | 'generating-video'
  | 'creating-flashcard'
  | 'generating-artifact'
  | 'calling-tool'
  | 'stopping';

export function resolveConversationActivityKind(input: {
  runState?: Pick<RunStatusView, 'kind'>;
  tools?: readonly ToolCardUi[];
  streaming?: boolean;
}): ConversationActivityKind | null {
  if (input.runState?.kind === 'stopping') {
    return 'stopping';
  }
  const runningTools = (input.tools ?? []).filter((tool) => tool.status === 'running');
  for (const tool of runningTools) {
    const generationKind = resolveGenerationToolKind(tool);
    if (generationKind === 'image') {
      return 'generating-image';
    }
    if (generationKind === 'video') {
      return 'generating-video';
    }
    if (isSearchTool(tool)) {
      return 'searching';
    }
    if (isFlashcardTool(tool)) {
      return 'creating-flashcard';
    }
    if (isArtifactTool(tool)) {
      return 'generating-artifact';
    }
    return 'calling-tool';
  }
  if (
    input.streaming === true ||
    input.runState?.kind === 'preparing' ||
    input.runState?.kind === 'connecting-model' ||
    input.runState?.kind === 'waiting-first-token' ||
    input.runState?.kind === 'working' ||
    input.runState?.kind === 'waiting-resource' ||
    input.runState?.kind === 'waiting-subagents'
  ) {
    return 'thinking';
  }
  return null;
}

export function conversationActivityLabel(
  kind: ConversationActivityKind,
  locale: 'zh-CN' | 'en' = 'zh-CN',
): string {
  if (locale === 'zh-CN') {
    switch (kind) {
      case 'searching':
        return '正在搜索…';
      case 'generating-image':
        return '正在生成图片…';
      case 'generating-video':
        return '正在生成视频…';
      case 'creating-flashcard':
        return '正在创建知识卡片…';
      case 'generating-artifact':
        return '正在生成内容…';
      case 'calling-tool':
        return '正在调用工具…';
      case 'stopping':
        return '正在停止…';
      case 'thinking':
        return '正在思考…';
    }
  }
  switch (kind) {
    case 'searching':
      return 'Searching…';
    case 'generating-image':
      return 'Generating image…';
    case 'generating-video':
      return 'Generating video…';
    case 'creating-flashcard':
      return 'Creating flashcard…';
    case 'generating-artifact':
      return 'Generating artifact…';
    case 'calling-tool':
      return 'Running tool…';
    case 'stopping':
      return 'Stopping…';
    case 'thinking':
      return 'Thinking…';
  }
}

function isSearchTool(tool: ToolCardUi): boolean {
  const names = [tool.toolName, tool.presentation?.routedToolName]
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
    .map((name) => name.toLowerCase());
  return names.some(
    (name) =>
      name === 'web_search' ||
      name === 'web_fetch' ||
      name.includes('web_search') ||
      name.includes('web-search'),
  );
}

function isFlashcardTool(tool: ToolCardUi): boolean {
  const names = [tool.toolName, tool.presentation?.routedToolName]
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
    .map((name) => name.toLowerCase());
  return names.some(
    (name) =>
      name.includes('flashcard') ||
      name.includes('flashcards'),
  );
}

function isArtifactTool(tool: ToolCardUi): boolean {
  const names = [tool.toolName, tool.presentation?.routedToolName]
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
    .map((name) => name.toLowerCase());
  return names.some(
    (name) =>
      name.includes('artifact') ||
      name.includes('create_artifact') ||
      name.includes('update_artifact'),
  );
}
