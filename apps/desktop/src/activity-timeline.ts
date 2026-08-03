/**
 * Pure UI projection: group consecutive read/search tools into Cursor-style
 * "Explored N files" segments so the call chain is easier to scan.
 * Does not change host events or chat-reducer data.
 */
import type { ToolCardUi } from './chat-reducer';

export type TimelineSegment =
  | { kind: 'tool'; tool: ToolCardUi }
  | { kind: 'explore'; tools: ToolCardUi[]; fileCount: number };

/**
 * Tools that read/search the workspace — candidates for explore batching.
 * Prefer host `actionVerb`; fall back to common tool names for older transcripts.
 */
export function isExploreLikeTool(tool: ToolCardUi): boolean {
  const actionVerb = tool.presentation?.actionVerb?.trim() ?? '';
  if (
    actionVerb === 'Read' ||
    actionVerb === 'Searched' ||
    actionVerb === 'Explored'
  ) {
    return true;
  }

  const toolName = tool.toolName.trim().toLowerCase();
  if (!toolName) {
    return false;
  }

  return (
    toolName === 'read' ||
    toolName === 'read_file' ||
    toolName === 'readfile' ||
    toolName === 'cat' ||
    toolName === 'grep' ||
    toolName === 'rg' ||
    toolName === 'search' ||
    toolName === 'glob' ||
    toolName === 'find' ||
    toolName === 'list_dir' ||
    toolName === 'listdir' ||
    toolName === 'ls' ||
    toolName === 'search_files' ||
    toolName === 'codebase_search' ||
    toolName === 'file_search' ||
    toolName.endsWith('_read') ||
    toolName.includes('read_file') ||
    toolName.includes('list_dir')
  );
}

/** Unique path count when presentation exposes paths; otherwise tool count. */
export function countExploreFiles(tools: ToolCardUi[]): number {
  const uniquePaths = new Set<string>();
  let toolsWithoutPaths = 0;

  for (const tool of tools) {
    const targetPaths = tool.presentation?.targetPaths;
    if (targetPaths && targetPaths.length > 0) {
      for (const path of targetPaths) {
        uniquePaths.add(path);
      }
    } else {
      toolsWithoutPaths += 1;
    }
  }

  const total = uniquePaths.size + toolsWithoutPaths;
  return Math.max(total, tools.length > 0 ? 1 : 0);
}

/**
 * Collapse consecutive explore-like tools (2+) into one explore segment.
 * Single explore tools stay as ordinary tool rows (e.g. "Read App.tsx").
 */
export function groupToolsForTimeline(tools: ToolCardUi[]): TimelineSegment[] {
  const segments: TimelineSegment[] = [];
  let exploreBatch: ToolCardUi[] = [];

  const flushExploreBatch = (): void => {
    if (exploreBatch.length === 0) {
      return;
    }
    if (exploreBatch.length >= 2) {
      segments.push({
        kind: 'explore',
        tools: exploreBatch,
        fileCount: countExploreFiles(exploreBatch),
      });
    } else {
      const onlyTool = exploreBatch[0];
      if (onlyTool) {
        segments.push({ kind: 'tool', tool: onlyTool });
      }
    }
    exploreBatch = [];
  };

  for (const tool of tools) {
    if (isExploreLikeTool(tool)) {
      exploreBatch.push(tool);
      continue;
    }
    flushExploreBatch();
    segments.push({ kind: 'tool', tool });
  }
  flushExploreBatch();

  return segments;
}

export function exploreGroupLabel(input: {
  fileCount: number;
  locale: 'zh-CN' | 'en';
  isActive: boolean;
}): string {
  const isChinese = input.locale === 'zh-CN';
  if (input.isActive) {
    return isChinese
      ? `正在探查... ${input.fileCount} 个文件`
      : `Exploring... ${input.fileCount} files`;
  }
  return isChinese
    ? `已探查 ${input.fileCount} 个文件`
    : `Explored ${input.fileCount} files`;
}
