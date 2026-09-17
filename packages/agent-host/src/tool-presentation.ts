/**
 * Pure host-side tool presentation builder.
 * Desktop must not re-classify tools from raw name strings when presentation is present.
 *
 * Head-row contract (Cursor-style):
 *   [icon] [actionVerb] [path pill | query preview] [countTag] … [status] [duration]
 */
import type {
  HealthToolCardSummary,
  ToolErrorView,
  ToolOutputView,
  ToolOutputTruncation,
  ToolPresentation,
} from '@piwin/contracts';
import { projectBoundedHealthToolCardSummary } from '@piwin/contracts';
import { attachFlashcardPresentation } from './flashcard-presentation.js';
import { attachGoalPresentation } from './goal-presentation.js';
import { attachKnowledgePresentation } from './knowledge-presentation.js';
import { attachWebSearchPresentation } from './web-search-presentation.js';
import { attachPlanPresentation } from './plan-presentation.js';
import { attachSubagentPresentation } from './subagent-presentation.js';
import {
  type ToolActionFamily,
  classifyToolKind,
  humanizeToolTitle,
  resolveActionFamily,
} from './tool-presentation-classification.js';

export { classifyToolKind, isWriteLikeTool } from './tool-presentation-classification.js';

function looksLikeCancelledToolOutput(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return (
    /\b(?:(?:this|the)\s+)?operation was aborted\b/.test(normalized) ||
    /\brequest was aborted\b/.test(normalized) ||
    /\bcommand aborted\b/.test(normalized) ||
    /\btool execution aborted\b/.test(normalized) ||
    /\baborted before executor\b/.test(normalized) ||
    /\bwas interrupted\b/.test(normalized) ||
    /\bwas cancelled\b/.test(normalized) ||
    /\buser stopped this run\b/.test(normalized) ||
    /\bsuperseded by a newer\b/.test(normalized) ||
    /\baborterror\b/.test(normalized) ||
    /已中止|已取消|操作已中止|用户已停止/.test(normalized)
  );
}

const MAX_TOOL_OUTPUT_CHARS = 8_000;
const MAX_SUMMARY_CHARS = 96;
/** Expanded MCP tool cards need more than the 96-char head clip. */
const MAX_MCP_ARGS_PREVIEW_CHARS = 32_000;

const SECRET_PATTERNS: RegExp[] = [
  /\b(?:api[_-]?key|token|secret|password|authorization)\b['"]?\s*[:=]\s*['"]?[^\s'"]+/gi,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /\bsk-[A-Za-z0-9]{16,}\b/g,
];

export type BuildToolPresentationInput = {
  toolName: string;
  args?: unknown;
  routedToolName?: string;
  outputText?: string;
  /** Raw tool result details; mined for structured goal signals. */
  details?: unknown;
  truncation?: ToolOutputTruncation;
  isError?: boolean;
  exitCode?: number | null;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  health?: HealthToolCardSummary;
  sensitivity?: 'health';
};

export type PresentedToolInvocation = {
  invokedToolName: string;
  effectiveToolName: string;
  effectiveArgs?: unknown;
  routedToolName?: string;
};

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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Resolve the effective invocation used for presentation without changing execution identity. */
export function resolvePresentedToolInvocation(
  toolName: string,
  args: unknown,
): PresentedToolInvocation {
  const normalizedArgs = coerceToolArgs(args);
  const unchanged = (): PresentedToolInvocation => ({
    invokedToolName: toolName,
    effectiveToolName: toolName,
    ...(normalizedArgs !== undefined ? { effectiveArgs: normalizedArgs } : {}),
  });
  if (toolName.trim().toLowerCase() !== 'piwin_toolbox' || !isPlainRecord(normalizedArgs)) {
    return unchanged();
  }
  const action =
    typeof normalizedArgs.action === 'string' ? normalizedArgs.action.trim().toLowerCase() : '';
  const target = typeof normalizedArgs.target === 'string' ? normalizedArgs.target.trim() : '';
  if (action !== 'call' || target.length === 0 || !isPlainRecord(normalizedArgs.arguments)) {
    return unchanged();
  }
  return {
    invokedToolName: toolName,
    effectiveToolName: target,
    effectiveArgs: normalizedArgs.arguments,
    routedToolName: target,
  };
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
/** Pi/host sometimes ship tool args as a JSON string instead of an object. */
export function coerceToolArgs(args: unknown): unknown {
  if (typeof args !== 'string') {
    return args;
  }
  const trimmed = args.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return args;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return args;
  }
}

export function buildToolPresentation(input: BuildToolPresentationInput): ToolPresentation {
  const family = resolveActionFamily(input.toolName);
  const kind = classifyToolKind(input.toolName);
  const title = humanizeToolTitle(input.toolName, kind);
  const args = coerceToolArgs(input.args);
  const presentation: ToolPresentation = {
    kind,
    title,
    ...(input.routedToolName !== undefined ? { routedToolName: input.routedToolName } : {}),
  };

  const argsPreview = formatArgsPreview(args, family);
  if (argsPreview) {
    presentation.inputPreview = argsPreview;
  }

  const command = extractCommand(family, args);
  if (command) {
    presentation.command = command;
  }

  const targetPaths = extractTargetPaths(family, args);
  if (targetPaths && targetPaths.length > 0) {
    presentation.targetPaths = targetPaths;
  }

  // Write/edit tools: surface target paths as changedPaths so Desktop can
  // aggregate a turn-level "files changed" bar and DiffCard without re-inferring.
  if (!input.isError && targetPaths && targetPaths.length > 0 && family === 'edit') {
    presentation.changedPaths = targetPaths;
  }

  if (input.health !== undefined) {
    presentation.health = input.health;
  }
  if (input.sensitivity !== undefined) {
    presentation.sensitivity = input.sensitivity;
  }
  if (family === 'health') {
    presentation.kind = 'health';
    presentation.sensitivity = 'health';
    if (presentation.health === undefined && args && typeof args === 'object') {
      const record = args as Record<string, unknown>;
      const directHealth = projectBoundedHealthToolCardSummary(record.health);
      if (directHealth !== undefined) {
        presentation.health = directHealth;
      } else {
        const metrics = Array.isArray(record.metrics)
          ? record.metrics.filter((m): m is any => typeof m === 'string')
          : [];
        const range =
          record.range && typeof record.range === 'object'
            ? (record.range as Record<string, unknown>)
            : undefined;
        const periodLabel = range?.preset === 'last-7-days' ? '近 7 天' : '今天';
        presentation.health = {
          metrics,
          periodLabel,
          status: 'waiting-for-phone',
        };
      }
    }
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
    const semanticallyTruncated = hasSemanticTruncation(input.toolName, input.outputText);
    presentation.output = {
      ...output,
      ...(semanticallyTruncated || input.truncation !== undefined ? { truncated: true } : {}),
      ...(input.truncation !== undefined ? { truncation: input.truncation } : {}),
    };
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
    args,
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
  } else if (
    presentation.inputPreview &&
    // MCP args stay in inputPreview for the expanded body; dumping raw JSON into
    // the header summary makes the title look broken (same class of bug as shell).
    // image/video keep prompt via extractActionDetails; never promote raw args JSON.
    family !== 'mcp' &&
    family !== 'image' &&
    family !== 'video'
  ) {
    presentation.summary = clipSummary(presentation.inputPreview);
  }

  if (toolWasCancelled) {
    presentation.summary = 'Cancelled before completion';
  }

  const withFlashcard = attachFlashcardPresentation(presentation, {
    toolName: input.toolName,
    ...(input.routedToolName !== undefined ? { routedToolName: input.routedToolName } : {}),
    ...(input.outputText !== undefined ? { outputText: input.outputText } : {}),
  });

  const detailsInput = {
    toolName: input.toolName,
    ...(input.routedToolName !== undefined ? { routedToolName: input.routedToolName } : {}),
    ...(input.details !== undefined ? { details: input.details } : {}),
  };
  const withGoal = attachGoalPresentation(withFlashcard, detailsInput);
  const withKnowledge = attachKnowledgePresentation(withGoal, detailsInput);
  const withWebSearch = attachWebSearchPresentation(withKnowledge, detailsInput);
  const withPlan = attachPlanPresentation(withWebSearch, detailsInput);
  return attachSubagentPresentation(withPlan, {
    toolName: input.toolName,
    ...(input.routedToolName !== undefined ? { routedToolName: input.routedToolName } : {}),
    args,
    ...(input.details !== undefined ? { details: input.details } : {}),
    ...(input.isError !== undefined ? { isError: input.isError } : {}),
  });
}

/**
 * Build inputPreview for tool cards.
 *
 * Default stays short (head-row / expanded args dump). Write/edit tools are
 * special: Desktop reopens failed/denied writes from `inputPreview.content`,
 * so we keep a much larger redacted JSON body (still bounded) instead of the
 * 96-char summary clip that produced half-cut document panels.
 */
const MAX_WRITE_ARGS_PREVIEW_CHARS = 200_000;

function formatArgsPreview(args: unknown, family?: ToolActionFamily): string | undefined {
  if (args === undefined || args === null) {
    return undefined;
  }
  if (typeof args === 'string') {
    const redacted = redactToolText(args).text;
    if (family === 'edit') {
      return clipSummary(redacted, MAX_WRITE_ARGS_PREVIEW_CHARS);
    }
    if (family === 'mcp') {
      return clipSummary(redacted, MAX_MCP_ARGS_PREVIEW_CHARS);
    }
    return clipSummary(redacted);
  }
  try {
    // For write/edit: serialize path + content (and common edit fields) without
    // collapsing whitespace inside the document body.
    if (family === 'edit' && args && typeof args === 'object') {
      const record = args as Record<string, unknown>;
      const previewRecord: Record<string, unknown> = {};
      for (const key of [
        'path',
        'file',
        'file_path',
        'filename',
        'target',
        'target_file',
        'targetFile',
        'content',
        'new_string',
        'newString',
        'old_string',
        'oldString',
        'contents',
      ]) {
        if (key in record) {
          previewRecord[key] = record[key];
        }
      }
      // If nothing recognized, fall back to full args (still bounded).
      const payload = Object.keys(previewRecord).length > 0 ? previewRecord : record;
      const raw = JSON.stringify(payload);
      const redacted = redactToolText(raw).text;
      return clipSummary(redacted, MAX_WRITE_ARGS_PREVIEW_CHARS);
    }
    const serialized = redactToolText(JSON.stringify(args)).text;
    if (family === 'mcp') {
      return clipSummary(serialized, MAX_MCP_ARGS_PREVIEW_CHARS);
    }
    return clipSummary(serialized);
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

function extractLeadingShellComment(command: string | undefined): string | undefined {
  if (!command) return undefined;
  const comment = command.match(/^\s*#\s*(.+?)\s*$/m)?.[1];
  if (comment?.trim()) return comment.trim();
  const echoMatch = command.match(/^\s*echo\s+["'](?:===+\s*)?([^"'=\n]+?)(?:\s*===+)?["']/);
  if (echoMatch?.[1]?.trim()) return echoMatch[1].trim();
  return undefined;
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
    'filepath',
    'filePath',
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

/** Full-path list for head rows: `/abs/a.tsx and 2 other files`. */
export function formatPathsSummary(paths: readonly string[]): string {
  const names = paths.map((path) => path.trim()).filter((name) => name.length > 0);
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

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
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

  if (toolName.trim().toLowerCase() === 'piwin_toolbox') {
    const operation = readString(record.action)?.trim().toLowerCase();
    switch (operation) {
      case 'search':
        return {
          actionVerb: 'Tool discovery',
          ...(searchQuery ? { summary: clipSummary(searchQuery) } : { summary: 'Catalog' }),
        };
      case 'describe':
        return {
          actionVerb: 'Tool discovery',
          summary: readString(record.target) ?? 'Tool schema',
        };
      case 'status':
        return {
          actionVerb: 'MCP status',
          summary: readString(record.target) ?? 'Servers',
        };
      default:
        return { actionVerb: 'Toolbox' };
    }
  }

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
      const desc =
        readString(record.description) ??
        readString(record.title) ??
        readString(record.toolSummary) ??
        extractLeadingShellComment(command);
      if (desc) {
        summary = clipSummary(desc, 120);
      } else if (command) {
        summary = clipSummary(command, 120);
      }
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
      if (toolName.includes('.')) {
        const separator = toolName.indexOf('.');
        const server = toolName.slice(0, separator);
        const tool = toolName.slice(separator + 1);
        actionVerb = server ? `MCP (${server})` : 'Called MCP';
        if (tool) summary = tool;
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
    case 'subagent': {
      actionVerb = 'Delegated';
      const task = readString(record.task);
      const sessionName = readString(record.sessionName);
      if (sessionName) summary = clipSummary(sessionName, 72);
      else if (task) summary = clipSummary(task, 96);
      break;
    }
    case 'health': {
      actionVerb = 'Health data';
      summary = 'Apple Health';
      break;
    }
    default: {
      actionVerb = humanizeToolTitle(toolName, 'other');
      if (searchQuery) summary = clipSummary(searchQuery);
      else if (targetPaths && targetPaths.length > 0) summary = formatPathsSummary(targetPaths);
      break;
    }
  }

  // Line range: explicit start/end, or read offset+limit (1-based span).
  const start = toFiniteNumber(record.StartLine ?? record.startLine ?? record.start_line);
  const end = toFiniteNumber(record.EndLine ?? record.endLine ?? record.end_line);
  if (start !== undefined && end !== undefined) {
    lineRange = `L${start}-${end}`;
  } else if (start !== undefined) {
    lineRange = `L${start}`;
  } else if (family === 'read') {
    const offset = toFiniteNumber(record.offset ?? record.line_offset);
    const limit = toFiniteNumber(record.limit ?? record.line_limit ?? record.lines);
    if (offset !== undefined) {
      const from = offset < 1 ? 1 : offset;
      lineRange = limit !== undefined && limit > 0 ? `L${from}-${from + limit - 1}` : `L${from}`;
    }
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
