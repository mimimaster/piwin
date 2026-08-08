/**
 * Pure host-side tool presentation builder.
 * Desktop must not re-classify tools from raw name strings when presentation is present.
 *
 * Head-row contract (Cursor-style):
 *   [icon] [actionVerb] [path pill | query preview] [countTag] … [status] [duration]
 */
import type { ToolErrorView, ToolKind, ToolOutputView, ToolPresentation } from '@piwin/contracts';

function looksLikeCancelledToolOutput(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return (
    normalized.includes('command aborted') ||
    normalized.includes('was interrupted') ||
    normalized.includes('was cancelled') ||
    normalized.includes('user stopped this run') ||
    normalized.includes('superseded by a newer')
  );
}

const MAX_TOOL_OUTPUT_CHARS = 8_000;
const MAX_SUMMARY_CHARS = 96;

const SECRET_PATTERNS: RegExp[] = [
  /\b(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*['"]?[^\s'"]+/gi,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /\bsk-[A-Za-z0-9]{16,}\b/g,
];

export type BuildToolPresentationInput = {
  toolName: string;
  args?: unknown;
  outputText?: string;
  isError?: boolean;
  exitCode?: number | null;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
};

/** Internal action family used only for presentation (not a contract field). */
type ToolActionFamily =
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
    case 'video':
      return 'other';
    default: {
      const normalized = toolName.trim().toLowerCase();
      if (normalized === 'process' || normalized.startsWith('process_')) {
        return 'process';
      }
      return 'other';
    }
  }
}

export function redactToolText(text: string): { text: string; redacted: boolean } {
  let next = text;
  let redacted = false;
  for (const pattern of SECRET_PATTERNS) {
    const replaced = next.replace(pattern, '[redacted]');
    if (replaced !== next) {
      redacted = true;
      next = replaced;
    }
  }
  return { text: next, redacted };
}

export function boundToolOutput(text: string): ToolOutputView {
  const redacted = redactToolText(text);
  if (redacted.text.length <= MAX_TOOL_OUTPUT_CHARS) {
    return {
      text: redacted.text,
      ...(redacted.redacted ? { redacted: true } : {}),
    };
  }
  return {
    text: `${redacted.text.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n[output truncated]`,
    truncated: true,
    ...(redacted.redacted ? { redacted: true } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function hasSemanticTruncation(toolName: string, outputText: string): boolean {
  if (resolveActionFamily(toolName) !== 'web-fetch') {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(outputText);
    return isRecord(parsed) && parsed.truncated === true;
  } catch {
    return false;
  }
}

/**
 * Build a ToolPresentation from known tool metadata. Does not invent fields
 * the provider did not supply.
 */
export function buildToolPresentation(input: BuildToolPresentationInput): ToolPresentation {
  const family = resolveActionFamily(input.toolName);
  const kind = classifyToolKind(input.toolName);
  const title = humanizeToolTitle(input.toolName, kind);
  const presentation: ToolPresentation = {
    kind,
    title,
  };

  const argsPreview = formatArgsPreview(input.args);
  if (argsPreview) {
    presentation.inputPreview = argsPreview;
  }

  const command = extractCommand(family, input.args);
  if (command) {
    presentation.command = command;
  }

  const targetPaths = extractTargetPaths(family, input.args);
  if (targetPaths && targetPaths.length > 0) {
    presentation.targetPaths = targetPaths;
  }

  // Write/edit tools: surface target paths as changedPaths so Desktop can
  // aggregate a turn-level "files changed" bar and DiffCard without re-inferring.
  if (!input.isError && targetPaths && targetPaths.length > 0 && family === 'edit') {
    presentation.changedPaths = targetPaths;
  }

  if (input.startedAt) {
    presentation.startedAt = input.startedAt;
  }
  if (input.endedAt) {
    presentation.endedAt = input.endedAt;
  }
  if (typeof input.durationMs === 'number') {
    presentation.durationMs = input.durationMs;
  }
  if (input.exitCode !== undefined) {
    presentation.exitCode = input.exitCode;
  }

  if (typeof input.outputText === 'string' && input.outputText.length > 0) {
    const output = boundToolOutput(input.outputText);
    presentation.output = hasSemanticTruncation(input.toolName, input.outputText)
      ? { ...output, truncated: true }
      : output;
  }

  let toolWasCancelled = false;
  if (input.isError) {
    const rawMessage =
      presentation.output?.text.slice(0, 240).replace(/\s+/g, ' ').trim() || 'Tool failed';
    toolWasCancelled = looksLikeCancelledToolOutput(rawMessage);
    const error: ToolErrorView = {
      category: toolWasCancelled ? 'cancelled' : 'execution',
      message: toolWasCancelled ? rawMessage.slice(0, 200) : rawMessage.slice(0, 120),
    };
    presentation.error = error;
  }

  const details = extractActionDetails({
    toolName: input.toolName,
    family,
    args: input.args,
    ...(input.outputText !== undefined ? { outputText: input.outputText } : {}),
    ...(presentation.targetPaths !== undefined ? { targetPaths: presentation.targetPaths } : {}),
    ...(presentation.command !== undefined ? { command: presentation.command } : {}),
  });
  presentation.actionVerb = details.actionVerb;
  if (details.lineRange) {
    presentation.lineRange = details.lineRange;
  }
  if (details.countTag) {
    presentation.countTag = details.countTag;
  }
  if (details.summary) {
    presentation.summary = details.summary;
  } else if (presentation.command) {
    presentation.summary = clipSummary(presentation.command);
  } else if (presentation.targetPaths && presentation.targetPaths.length > 0) {
    presentation.summary = formatPathsSummary(presentation.targetPaths);
  } else if (presentation.inputPreview && family !== 'mcp') {
    // MCP args stay in inputPreview for the expanded body; dumping raw JSON into
    // the header summary makes the title look broken (same class of bug as shell).
    presentation.summary = clipSummary(presentation.inputPreview);
  } else if (presentation.output?.text) {
    presentation.summary = clipSummary(presentation.output.text.replace(/\s+/g, ' ').trim());
  }

  if (toolWasCancelled) {
    presentation.summary = 'Cancelled before completion';
  }

  return presentation;
}

function resolveActionFamily(toolName: string): ToolActionFamily {
  const n = toolName.trim().toLowerCase();
  if (!n) return 'other';

  if (n === 'mcp_gateway' || n.startsWith('mcp__') || n.startsWith('mcp:')) return 'mcp';

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

function humanizeToolTitle(toolName: string, kind: ToolKind): string {
  if (kind === 'mcp') {
    if (toolName.trim().toLowerCase() === 'mcp_gateway') {
      return 'MCP gateway';
    }
    return toolName.replace(/^mcp__?/, '').replace(/__/g, ' / ') || toolName;
  }
  return toolName;
}

function formatArgsPreview(args: unknown): string | undefined {
  if (args === undefined || args === null) {
    return undefined;
  }
  if (typeof args === 'string') {
    return clipSummary(redactToolText(args).text);
  }
  try {
    return clipSummary(redactToolText(JSON.stringify(args)).text);
  } catch {
    return undefined;
  }
}

function extractCommand(family: ToolActionFamily, args: unknown): string | undefined {
  if (family !== 'shell') {
    return undefined;
  }
  if (!args || typeof args !== 'object') {
    return undefined;
  }
  const record = args as Record<string, unknown>;
  const command = readString(record.command) ?? readString(record.cmd) ?? readString(record.script);
  return command ? redactToolText(command).text : undefined;
}

function extractTargetPaths(family: ToolActionFamily, args: unknown): string[] | undefined {
  if (
    family !== 'read' &&
    family !== 'edit' &&
    family !== 'search' &&
    family !== 'explore' &&
    family !== 'git'
  ) {
    return undefined;
  }
  if (!args || typeof args !== 'object') {
    return undefined;
  }
  const record = args as Record<string, unknown>;
  const paths: string[] = [];
  for (const key of [
    'path',
    'file',
    'file_path',
    'filename',
    'target',
    'target_file',
    'targetFile',
    'glob',
    'glob_pattern',
    'GlobPattern',
    'directory',
    'dir',
    'cwd',
  ]) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      paths.push(value.trim());
    }
  }
  for (const key of ['paths', 'files', 'file_paths', 'target_paths']) {
    const list = record[key];
    if (Array.isArray(list)) {
      for (const item of list) {
        if (typeof item === 'string' && item.trim()) {
          paths.push(item.trim());
        }
      }
    }
  }
  return paths.length > 0 ? dedupePaths(paths) : undefined;
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

/** Basename-first path list for head rows: `a.tsx and 2 other files`. */
export function formatPathsSummary(paths: readonly string[]): string {
  const names = paths.map((path) => basename(path)).filter((name) => name.length > 0);
  if (names.length === 0) {
    return '';
  }
  if (names.length === 1) {
    return names[0] ?? '';
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }
  return `${names[0]} and ${names.length - 1} other files`;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function isGlobPattern(value: string): boolean {
  return value.includes('*') || value.includes('?') || value.includes('**');
}

function extractSearchQuery(args: unknown): string | undefined {
  if (!args || typeof args === 'string') {
    return typeof args === 'string' && args.trim() ? redactToolText(args.trim()).text : undefined;
  }
  if (!args || typeof args !== 'object') {
    return undefined;
  }
  const record = args as Record<string, unknown>;
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
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return redactToolText(value.trim()).text;
    }
  }
  return undefined;
}

function extractUrl(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const record = args as Record<string, unknown>;
  for (const key of ['url', 'uri', 'href', 'link']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function extractPrompt(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const record = args as Record<string, unknown>;
  const prompt = readString(record.prompt) ?? readString(record.description);
  return prompt ? redactToolText(prompt).text : undefined;
}

/** True for tools that mutate file contents (not read/search). */
export function isWriteLikeTool(toolName: string, kind: ToolKind): boolean {
  if (kind !== 'filesystem') {
    return false;
  }
  return resolveActionFamily(toolName) === 'edit';
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function clipSummary(text: string, max = MAX_SUMMARY_CHARS): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}…`;
}

function extractActionDetails(input: {
  toolName: string;
  family: ToolActionFamily;
  args: unknown;
  outputText?: string;
  targetPaths?: readonly string[];
  command?: string;
}): {
  actionVerb: string;
  lineRange?: string;
  countTag?: string;
  summary?: string;
} {
  const { family, args, outputText, targetPaths, command, toolName } = input;
  const record = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
  const searchQuery = extractSearchQuery(args);

  let actionVerb: string;
  let summary: string | undefined;
  let countTag: string | undefined;
  let lineRange: string | undefined;

  switch (family) {
    case 'search':
    case 'web-search': {
      actionVerb = 'Searched';
      if (searchQuery) summary = clipSummary(searchQuery);
      break;
    }
    case 'explore': {
      actionVerb = 'Explored';
      if (targetPaths && targetPaths.length > 0) {
        const first = targetPaths[0] ?? '';
        summary = isGlobPattern(first) ? first : formatPathsSummary(targetPaths);
      } else if (searchQuery) {
        summary = clipSummary(searchQuery);
      }
      break;
    }
    case 'read': {
      actionVerb = 'Read';
      if (targetPaths && targetPaths.length > 0) {
        summary = formatPathsSummary(targetPaths);
      }
      break;
    }
    case 'edit': {
      actionVerb = 'Edited';
      if (targetPaths && targetPaths.length > 0) {
        summary = formatPathsSummary(targetPaths);
      }
      break;
    }
    case 'shell': {
      actionVerb = 'Ran command';
      if (command) summary = clipSummary(command, 120);
      break;
    }
    case 'git': {
      actionVerb = gitActionVerb(toolName, args);
      if (targetPaths && targetPaths.length > 0) {
        summary = formatPathsSummary(targetPaths);
      } else if (searchQuery) {
        summary = clipSummary(searchQuery);
      } else {
        const message = readString(record.message) ?? readString(record.commit_message);
        if (message) summary = clipSummary(message);
      }
      break;
    }
    case 'web-fetch': {
      actionVerb = 'Fetched';
      const url = extractUrl(args);
      if (url) summary = clipSummary(url, 80);
      break;
    }
    case 'mcp': {
      if (toolName.trim().toLowerCase() === 'mcp_gateway') {
        const operation = readString(record.action)?.trim().toLowerCase();
        switch (operation) {
          case 'search':
            actionVerb = 'MCP discovery';
            if (searchQuery) summary = clipSummary(searchQuery);
            else if (readString(record.serverId)) summary = `Server ${readString(record.serverId)}`;
            else summary = 'MCP tools';
            break;
          case 'describe':
            actionVerb = 'MCP discovery';
            summary = readString(record.selector) ?? 'Tool schema';
            break;
          case 'status':
            actionVerb = 'MCP status';
            summary = readString(record.serverId) ?? 'Servers';
            break;
          case 'call':
            actionVerb = 'MCP call';
            summary = readString(record.selector) ?? 'MCP tool';
            break;
          default:
            actionVerb = 'MCP gateway';
            break;
        }
        break;
      }
      const parts = toolName.replace(/^mcp__?/, '').split('__');
      const server = parts[0];
      // Only the segments after the server are the tool name; do not fall back to
      // the server id (that left summary empty → raw JSON args in the header).
      const tool = parts.slice(1).filter(Boolean).join(' / ');
      actionVerb = server ? `MCP (${server})` : 'Called MCP';
      if (tool) summary = tool;
      break;
    }
    case 'image': {
      actionVerb = 'Generated image';
      const prompt = extractPrompt(args);
      if (prompt) summary = clipSummary(prompt, 72);
      break;
    }
    case 'video': {
      actionVerb = 'Generated video';
      const prompt = extractPrompt(args);
      if (prompt) summary = clipSummary(prompt, 72);
      break;
    }
    default: {
      actionVerb = humanizeToolTitle(toolName, 'other');
      if (searchQuery) summary = clipSummary(searchQuery);
      else if (targetPaths && targetPaths.length > 0) summary = formatPathsSummary(targetPaths);
      break;
    }
  }

  // Line range (explicit start/end only — avoid treating limit/offset as lines).
  const start = record.StartLine ?? record.startLine ?? record.start_line;
  const end = record.EndLine ?? record.endLine ?? record.end_line;
  if (typeof start === 'number' && typeof end === 'number') {
    lineRange = `L${start}-${end}`;
  } else if (typeof start === 'number') {
    lineRange = `L${start}`;
  }

  // Result counts for search / explore.
  if (outputText && (family === 'search' || family === 'explore' || family === 'web-search')) {
    countTag = extractResultCountTag(outputText, family);
  }
  if (targetPaths && targetPaths.length > 1 && (family === 'read' || family === 'edit')) {
    countTag = countTag ?? `${targetPaths.length} files`;
  }

  return {
    actionVerb,
    ...(lineRange !== undefined ? { lineRange } : {}),
    ...(countTag !== undefined ? { countTag } : {}),
    ...(summary !== undefined ? { summary } : {}),
  };
}

function gitActionVerb(toolName: string, args: unknown): string {
  const n = toolName.toLowerCase();
  if (n.includes('status')) return 'Git status';
  if (n.includes('diff')) return 'Git diff';
  if (n.includes('log') || n.includes('show')) return 'Git log';
  if (n.includes('commit')) return 'Git commit';
  if (n.includes('push')) return 'Git push';
  if (n.includes('pull') || n.includes('fetch')) return 'Git pull';
  if (n.includes('branch')) return 'Git branch';
  if (n.includes('checkout') || n.includes('switch')) return 'Git checkout';
  if (n.includes('add') || n.includes('stage')) return 'Git add';
  // Generic `git` tool with subcommand in args.
  if (args && typeof args === 'object') {
    const record = args as Record<string, unknown>;
    const sub =
      readString(record.command) ??
      readString(record.subcommand) ??
      readString(record.action) ??
      (Array.isArray(record.args) && typeof record.args[0] === 'string'
        ? record.args[0]
        : undefined);
    if (sub) {
      const first = sub.trim().split(/\s+/)[0]?.toLowerCase();
      if (first === 'status') return 'Git status';
      if (first === 'diff') return 'Git diff';
      if (first === 'log' || first === 'show') return 'Git log';
      if (first === 'commit') return 'Git commit';
      if (first === 'push') return 'Git push';
      if (first === 'pull' || first === 'fetch') return 'Git pull';
      if (first === 'branch') return 'Git branch';
      if (first === 'checkout' || first === 'switch') return 'Git checkout';
      if (first === 'add') return 'Git add';
      if (first) return `Git ${first}`;
    }
  }
  return 'Git';
}

function extractResultCountTag(outputText: string, family: ToolActionFamily): string | undefined {
  try {
    const parsed = JSON.parse(outputText) as unknown;
    if (Array.isArray(parsed)) {
      const unit = family === 'explore' ? 'files' : 'results';
      return `${parsed.length} ${unit}`;
    }
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.matches)) return `${obj.matches.length} results`;
      if (Array.isArray(obj.files)) return `${obj.files.length} files`;
      if (Array.isArray(obj.results)) return `${obj.results.length} results`;
      if (typeof obj.count === 'number') return `${obj.count} results`;
      if (typeof obj.total === 'number') return `${obj.total} results`;
    }
  } catch {
    const lines = outputText.split('\n').filter((line) => line.trim().length > 0);
    if (lines.length > 0 && lines.length <= 500) {
      return family === 'explore' ? `${lines.length} files` : `${lines.length} matches`;
    }
  }
  return undefined;
}
