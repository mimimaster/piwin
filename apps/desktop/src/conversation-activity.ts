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
  }
  if (
    input.streaming === true ||
    input.runState?.kind === 'preparing' ||
    input.runState?.kind === 'connecting-model' ||
    input.runState?.kind === 'waiting-first-token' ||
    input.runState?.kind === 'working' ||
    input.runState?.kind === 'waiting-resource'
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
