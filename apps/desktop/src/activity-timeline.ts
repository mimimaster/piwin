/**
 * Pure UI projection: group consecutive read/search tools into Cursor-style
 * "Explored N files" segments so the call chain is easier to scan.
 * Does not change host events or chat-reducer data.
 */
import type { ToolCardUi } from './chat-reducer';
import { resolveToolBehaviorId } from './behavior-activity.js';

export type TimelineSegment =
  { kind: 'tool'; tool: ToolCardUi } | { kind: 'explore'; tools: ToolCardUi[]; fileCount: number };

export type ToolHistoryCategory =
  'explore' | 'edit' | 'command' | 'web' | 'mcp' | 'generation' | 'delegate' | 'other';

export type ToolHistoryCategoryGroup = {
  category: ToolHistoryCategory;
  tools: ToolCardUi[];
};

const TOOL_HISTORY_CATEGORY_ORDER: readonly ToolHistoryCategory[] = [
  'explore',
  'edit',
  'command',
  'web',
  'mcp',
  'generation',
  'delegate',
  'other',
];

/** Map the normalized behavior vocabulary into stable user-facing history buckets. */
export function classifyToolHistoryCategory(tool: ToolCardUi): ToolHistoryCategory {
  const behaviorId = resolveToolBehaviorId({
    kind: tool.presentation?.kind ?? 'unknown',
    toolName: tool.toolName,
    ...(tool.presentation?.actionVerb ? { actionVerb: tool.presentation.actionVerb } : {}),
  });

  switch (behaviorId) {
    case 'explore':
    case 'search':
    case 'read':
      return 'explore';
    case 'edit':
    case 'git':
      return 'edit';
    case 'shell':
    case 'test':
    case 'build':
    case 'process':
      return 'command';
    case 'web.search':
    case 'web.fetch':
    case 'browser':
      return 'web';
    case 'mcp.server.connect':
    case 'mcp.server.stop':
    case 'mcp.server.status':
    case 'mcp.discovery':
    case 'mcp.call':
    case 'mcp.call.done':
    case 'mcp.call.error':
      return 'mcp';
    case 'artifact':
    case 'image':
    case 'video':
      return 'generation';
    case 'subagent.batch.prepare':
    case 'subagent.batch.running':
    case 'subagent.batch.complete':
    case 'subagent.batch.fail':
    case 'subagent.batch.cancelled':
    case 'subagent.task.queued':
    case 'subagent.task.running':
    case 'subagent.task.complete':
    case 'subagent.task.fail':
    case 'subagent.task.cancelled':
    case 'subagent.inspector.live':
    case 'subagent':
      return 'delegate';
    default:
      return 'other';
  }
}

export function groupToolsByHistoryCategory(
  tools: readonly ToolCardUi[],
): ToolHistoryCategoryGroup[] {
  const toolsByCategory = new Map<ToolHistoryCategory, ToolCardUi[]>();
  for (const tool of tools) {
    const category = classifyToolHistoryCategory(tool);
    const categoryTools = toolsByCategory.get(category);
    if (categoryTools) {
      categoryTools.push(tool);
    } else {
      toolsByCategory.set(category, [tool]);
    }
  }

  return TOOL_HISTORY_CATEGORY_ORDER.flatMap((category) => {
    const categoryTools = toolsByCategory.get(category);
    return categoryTools ? [{ category, tools: categoryTools }] : [];
  });
}

export function toolHistoryCategoryLabel(
  category: ToolHistoryCategory,
  locale: 'zh-CN' | 'en',
): string {
  const labels: Record<ToolHistoryCategory, readonly [string, string]> = {
    explore: ['读取与搜索', 'Read & search'],
    edit: ['编辑与 Git', 'Edit & Git'],
    command: ['命令与任务', 'Commands & jobs'],
    web: ['网络与浏览器', 'Web & browser'],
    mcp: ['MCP', 'MCP'],
    generation: ['生成内容', 'Generation'],
    delegate: ['子代理', 'Delegation'],
    other: ['其他', 'Other'],
  };
  return labels[category][locale === 'zh-CN' ? 0 : 1];
}

/**
 * Tools that read/search the workspace — candidates for explore batching.
 * Prefer host `actionVerb`; fall back to common tool names for older transcripts.
 */
export function isExploreLikeTool(tool: ToolCardUi): boolean {
  const actionVerb = tool.presentation?.actionVerb?.trim() ?? '';
  if (actionVerb === 'Read' || actionVerb === 'Searched' || actionVerb === 'Explored') {
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

export function isSearchTool(tool: ToolCardUi): boolean {
  const actionVerb = tool.presentation?.actionVerb?.trim() ?? '';
  if (actionVerb === 'Searched') return true;

  const toolName = tool.toolName.trim().toLowerCase();
  return (
    toolName === 'grep' ||
    toolName === 'grep_search' ||
    toolName === 'rg' ||
    toolName === 'codebase_search' ||
    toolName === 'search_code' ||
    toolName === 'file_search' ||
    toolName === 'find_content' ||
    toolName.endsWith('_search') ||
    toolName.includes('grep')
  );
}

export function extractSearchResultFiles(tool: ToolCardUi): string[] {
  const outputText = tool.presentation?.output?.text ?? tool.output ?? '';
  const paths: string[] = [];

  if (outputText) {
    try {
      const parsed = JSON.parse(outputText) as unknown;
      let list: unknown[] = [];
      if (Array.isArray(parsed)) {
        list = parsed;
      } else if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        if (Array.isArray(obj.matches)) list = obj.matches;
        else if (Array.isArray(obj.files)) list = obj.files;
        else if (Array.isArray(obj.results)) list = obj.results;
      }
      for (const item of list) {
        if (typeof item === 'string' && item.trim()) {
          paths.push(item.trim());
        } else if (item && typeof item === 'object') {
          const rec = item as Record<string, unknown>;
          const f =
            rec.Filename ??
            rec.filename ??
            rec.File ??
            rec.file ??
            rec.path ??
            rec.Path ??
            rec.filePath ??
            rec.targetPath;
          if (typeof f === 'string' && f.trim()) {
            paths.push(f.trim());
          }
        }
      }
    } catch {
      const lines = outputText.split('\n');
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          const possiblePath = line.slice(0, colonIdx).trim();
          if (/[\/\\]|\.[a-zA-Z0-9]+$/.test(possiblePath) && !/\s/.test(possiblePath)) {
            paths.push(possiblePath);
            continue;
          }
        }
        if (/^[\/\\]?[a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+$/.test(line)) {
          paths.push(line);
        }
      }
    }
  }

  const unique = Array.from(new Set(paths));
  if (unique.length > 0) {
    return unique;
  }

  return tool.presentation?.targetPaths ?? [];
}

export type SearchToolInfo = {
  query: string;
  dir?: string | undefined;
  pattern?: string | undefined;
  count: number;
  countTag: string;
  matchedFiles: string[];
  isError: boolean;
  errorMessage?: string | undefined;
};

function parseArgsFromInputPreview(inputPreview?: string): Record<string, unknown> {
  if (!inputPreview) return {};
  try {
    const parsed = JSON.parse(inputPreview) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore JSON parse error
  }
  return {};
}

export function extractSearchInfo(tool: ToolCardUi, projectPath?: string | null): SearchToolInfo {
  const isError = tool.status === 'error' || Boolean(tool.presentation?.error);
  const errorMessage = tool.presentation?.error?.message ?? (isError ? tool.output : undefined);
  const previewArgs = parseArgsFromInputPreview(tool.presentation?.inputPreview);

  let query = tool.presentation?.summary;
  if (!query || query === tool.toolName || (query.startsWith('{') && query.endsWith('}'))) {
    for (const key of [
      'query',
      'Query',
      'pattern',
      'Pattern',
      'regex',
      'search',
      'search_term',
      'searchTerm',
      'needle',
      'text',
    ]) {
      const val = previewArgs[key];
      if (typeof val === 'string' && val.trim()) {
        query = val.trim();
        break;
      }
    }
  }
  if (!query) {
    query = tool.toolName;
  }

  let dir: string | undefined = undefined;
  for (const key of ['SearchPath', 'SearchDir', 'dir', 'directory', 'path', 'cwd', 'search_path']) {
    const val = previewArgs[key];
    if (typeof val === 'string' && val.trim()) {
      let rawDir = val.trim();
      if (projectPath && rawDir.startsWith(projectPath)) {
        rawDir = rawDir.slice(projectPath.length).replace(/^[\\/]+/, '');
      }
      if (rawDir) {
        dir = rawDir;
        break;
      }
    }
  }

  let pattern: string | undefined = undefined;
  for (const key of [
    'Includes',
    'includes',
    'glob',
    'glob_pattern',
    'pattern',
    'extension',
    'file_pattern',
  ]) {
    const val = previewArgs[key];
    if (Array.isArray(val) && val.length > 0) {
      pattern = val.map(String).join(', ');
      break;
    } else if (typeof val === 'string' && val.trim()) {
      pattern = val.trim();
      break;
    }
  }

  const matchedFiles = extractSearchResultFiles(tool);
  const count = matchedFiles.length;
  const countTag = tool.presentation?.countTag ?? `${count}`;

  const info: SearchToolInfo = {
    query,
    count,
    countTag,
    matchedFiles,
    isError,
  };
  if (dir !== undefined) info.dir = dir;
  if (pattern !== undefined) info.pattern = pattern;
  if (errorMessage !== undefined) info.errorMessage = errorMessage;

  return info;
}

export function formatFilePillPath(
  filePath: string,
  searchDir?: string,
  projectPath?: string | null,
): { absolutePath: string; relativePath: string; displayPath: string } {
  let clean = filePath.trim();
  let absolutePath = clean;
  let relativePath = clean;

  if (projectPath && clean.startsWith(projectPath)) {
    relativePath = clean.slice(projectPath.length).replace(/^[\\/]+/, '');
  } else if (projectPath && !clean.startsWith('/') && !clean.includes(':')) {
    absolutePath = `${projectPath.replace(/[\\/]+$/, '')}/${clean}`;
  }

  let display = relativePath;
  if (searchDir && relativePath.startsWith(searchDir)) {
    display = relativePath.slice(searchDir.length);
  }
  display = display.replace(/^[\\/]+/, '');
  display = `/${display}`;

  return { absolutePath, relativePath, displayPath: display };
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
  return isChinese ? `已探查 ${input.fileCount} 个文件` : `Explored ${input.fileCount} files`;
}
