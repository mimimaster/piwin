import type { ToolKind } from '@piwin/contracts';

export type ToolActionFamily =
  | 'read'
  | 'search'
  | 'explore'
  | 'edit'
  | 'shell'
  | 'git'
  | 'web-search'
  | 'web-fetch'
  | 'mcp'
  | 'image'
  | 'video'
  | 'subagent'
  | 'health'
  | 'other';

/**
 * Classify known product tool names. Unknown / MCP-style names become `other`
 * or `mcp` without inventing filesystem/shell semantics from substrings alone.
 */
export function classifyToolKind(toolName: string): ToolKind {
  const family = resolveActionFamily(toolName);
  switch (family) {
    case 'shell':
      return 'shell';
    case 'git':
      return 'git';
    case 'web-search':
    case 'web-fetch':
      return 'web';
    case 'mcp':
      return 'mcp';
    case 'read':
    case 'search':
    case 'explore':
    case 'edit':
      return 'filesystem';
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'subagent':
      return 'subagent';
    case 'health':
      return 'health';
    default: {
      const normalized = toolName.trim().toLowerCase();
      if (normalized === 'process' || normalized.startsWith('process_')) {
        return 'process';
      }
      return 'other';
    }
  }
}

export function resolveActionFamily(toolName: string): ToolActionFamily {
  const n = toolName.trim().toLowerCase();
  if (!n) return 'other';

  if (n === 'mcp_gateway' || n.startsWith('mcp__') || n.startsWith('mcp:') || n.includes('.')) {
    return 'mcp';
  }

  if (
    n === 'bash' ||
    n === 'shell' ||
    n === 'run_terminal_cmd' ||
    n === 'execute_command' ||
    n === 'run_command'
  ) {
    return 'shell';
  }

  if (n === 'web_search' || n === 'web-search') return 'web-search';
  if (n === 'web_fetch' || n === 'web-fetch' || n === 'fetch_url') return 'web-fetch';
  if (n.startsWith('web_')) {
    return n.includes('search') ? 'web-search' : 'web-fetch';
  }

  if (n === 'git' || n.startsWith('git_') || n.startsWith('git-')) return 'git';

  if (n === 'image_gen' || n === 'image_generate' || n.includes('image_gen')) return 'image';
  if (n === 'video_gen' || n === 'video_generate' || n.includes('video_gen')) return 'video';
  if (n === 'piwin_subagent_run') return 'subagent';
  if (n === 'health_read_context' || n.startsWith('health_') || n.startsWith('health:')) {
    return 'health';
  }

  if (
    n === 'write' ||
    n === 'edit' ||
    n === 'apply_patch' ||
    n === 'write_file' ||
    n === 'str_replace' ||
    n === 'search_replace' ||
    n === 'apply_diff' ||
    n === 'multi_edit' ||
    n.endsWith('_write') ||
    n.endsWith('_edit')
  ) {
    return 'edit';
  }

  if (
    n === 'read' ||
    n === 'read_file' ||
    n === 'view' ||
    n === 'view_file' ||
    n === 'open_file' ||
    n.startsWith('read_') ||
    n.endsWith('_read')
  ) {
    return 'read';
  }

  if (
    n === 'grep' ||
    n === 'rg' ||
    n === 'grep_search' ||
    n === 'codebase_search' ||
    n === 'semantic_search' ||
    n === 'find_content' ||
    n === 'search_code' ||
    n.includes('grep') ||
    (n.endsWith('_search') && !n.startsWith('web_') && !n.includes('glob'))
  ) {
    return 'search';
  }

  if (
    n === 'glob' ||
    n === 'glob_file_search' ||
    n === 'find' ||
    n === 'find_files' ||
    n === 'list_dir' ||
    n === 'list_files' ||
    n === 'ls' ||
    n === 'tree' ||
    n.includes('glob') ||
    n.includes('list_dir') ||
    n.includes('explore')
  ) {
    return 'explore';
  }

  // Soft fallbacks for common aliases without inventing FS for random names.
  if (n.includes('write') || n.includes('edit') || n.includes('replace') || n.includes('patch')) {
    return 'edit';
  }
  if (n.includes('read') || n.includes('view')) {
    return 'read';
  }

  return 'other';
}

export function humanizeToolTitle(toolName: string, kind: ToolKind): string {
  if (kind === 'subagent') return 'Subagent';
  if (kind === 'mcp') {
    if (toolName.trim().toLowerCase() === 'mcp_gateway') {
      return 'MCP gateway';
    }
    if (toolName.trim().toLowerCase() === 'piwin_toolbox') {
      return 'Tool catalog';
    }
    if (toolName.includes('.')) {
      return toolName;
    }
    return toolName.replace(/^mcp__?/, '').replace(/__/g, ' / ') || toolName;
  }
  return toolName;
}

/** True for tools that mutate file contents (not read/search). */
export function isWriteLikeTool(toolName: string, kind: ToolKind): boolean {
  if (kind !== 'filesystem') {
    return false;
  }
  return resolveActionFamily(toolName) === 'edit';
}
