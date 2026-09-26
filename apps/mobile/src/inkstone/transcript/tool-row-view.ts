import type { SubagentExecutionStatus, ToolKind } from '@piwin/contracts';
import type { InkstoneIconName } from '../icons.js';
import type { MobileToolCall } from '../../mobile-transcript.js';

/**
 * Collapsed tool-row projection. Every field is read from the Host-authored
 * `ToolPresentation`; the shell only shortens and formats, it never infers
 * what a tool did.
 */
export type ToolRowStatus = 'run' | 'done' | 'fail';

export interface ToolRowView {
  id: string;
  status: ToolRowStatus;
  /** Mono, bold tool name — the prototype's `read` / `bash` / `write_file`. */
  verb: string;
  /** Kind glyph before the verb, so a chain of rows scans by shape, not by reading. */
  icon: InkstoneIconName;
  /** One argument chip: the command, a shortened path, or a readable summary. */
  arg: string | undefined;
  meta: string[];
  /** Non-zero exit or Host error message, shown in crimson. */
  failure: string | undefined;
  changedPaths: string[];
  targetPaths: string[];
  command: string | undefined;
  /** Questionnaire tools show the question instead of an argument dump. */
  question: string | undefined;
  isWrite: boolean;
  /** Subagent control tools (start / wait / cancel) render as azure delegation rows. */
  subagent: SubagentRowView | undefined;
}

export interface SubagentRunView {
  runId: string;
  title: string;
  status: SubagentExecutionStatus;
  statusLabel: string;
  activity: string | undefined;
  childSessionId: string | undefined;
}

export interface SubagentRowView {
  task: string | undefined;
  childSessionId: string | undefined;
  runs: SubagentRunView[];
}

const SUBAGENT_VERBS: Record<string, string> = {
  piwin_subagent_start: '委派子代理',
  piwin_subagent_run: '委派子代理',
  piwin_subagent_wait: '等待子代理',
  piwin_subagent_cancel: '取消子代理',
};

const SUBAGENT_STATUS: Record<SubagentExecutionStatus, string> = {
  queued: '排队中',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const MAX_PATH_CHIP = 38;

export function projectToolRow(tool: MobileToolCall): ToolRowView {
  const presentation = tool.presentation;
  const rawVerb = presentation?.routedToolName ?? tool.name;
  const subagent = projectSubagent(tool);
  const verb = subagent !== undefined ? SUBAGENT_VERBS[rawVerb] ?? '子代理' : rawVerb;
  const command = presentation?.command ?? tool.command;
  const targetPaths = presentation?.targetPaths ?? tool.targetPaths ?? [];
  const changedPaths = presentation?.changedPaths ?? [];
  const question = isQuestionTool(rawVerb) ? readQuestionPrompt(presentation?.inputPreview ?? presentation?.summary) : undefined;
  const exitCode = presentation?.exitCode;
  const failure =
    tool.status === 'error'
      ? presentation?.error?.message ?? tool.error ?? '执行失败'
      : typeof exitCode === 'number' && exitCode !== 0
        ? `退出码 ${exitCode}`
        : undefined;
  return {
    id: tool.id,
    status: tool.status === 'running' ? 'run' : tool.status === 'error' || failure !== undefined ? 'fail' : 'done',
    verb,
    icon: subagent !== undefined ? 'branch' : toolRowIcon(presentation?.kind, rawVerb, changedPaths.length > 0),
    arg: question ?? resolveArgChip(command, targetPaths, presentation?.summary ?? tool.summary),
    meta: buildMeta(tool),
    failure,
    changedPaths,
    targetPaths,
    command,
    question,
    isWrite: changedPaths.length > 0,
    subagent,
  };
}

/**
 * Same buckets as Desktop's chain icons (shell / read / edit / search / web /
 * git / mcp / media). Host `kind` decides first; the tool name only splits the
 * filesystem bucket and rescues `other`.
 */
export function toolRowIcon(kind: ToolKind | undefined, toolName: string, wroteFiles: boolean): InkstoneIconName {
  const name = toolName.toLowerCase();
  const searches = /(^|_)(grep|glob|find|search|ls)($|_)|code_search/.test(name);
  switch (kind) {
    case 'shell':
    case 'process':
      return 'term';
    case 'git':
      return 'git';
    case 'web':
      return 'globe';
    case 'mcp':
      return 'puzzle';
    case 'image':
    case 'video':
      return 'image';
    case 'subagent':
      return 'branch';
    case 'health':
      return 'drop';
    case 'filesystem':
      if (wroteFiles || /write|edit|patch|create/.test(name)) return 'edit';
      return searches ? 'search' : 'file';
    default:
      break;
  }
  if (name === 'bash') return 'term';
  if (name.includes('question')) return 'chat';
  if (searches) return 'search';
  if (/fetch|web|browser/.test(name)) return 'globe';
  return 'bolt';
}

function projectSubagent(tool: MobileToolCall): SubagentRowView | undefined {
  const presentation = tool.presentation;
  const name = presentation?.routedToolName ?? tool.name;
  const control = presentation?.subagentControl;
  if (presentation?.kind !== 'subagent' && SUBAGENT_VERBS[name] === undefined && control === undefined) {
    return undefined;
  }
  if (control === undefined) {
    return {
      task: readJsonStringField(presentation?.inputPreview, ['task']),
      childSessionId: undefined,
      runs: [],
    };
  }
  if (control.phase === 'accepted') {
    return { task: control.task, childSessionId: control.childSessionId, runs: [] };
  }
  return {
    task: undefined,
    childSessionId: undefined,
    runs: control.runs.map((run) => ({
      runId: run.runId,
      title: run.title ?? run.runId.slice(0, 8),
      status: run.executionStatus,
      statusLabel: SUBAGENT_STATUS[run.executionStatus],
      activity: run.summaryPreview ?? run.activity,
      childSessionId: run.childSessionId,
    })),
  };
}

function buildMeta(tool: MobileToolCall): string[] {
  const presentation = tool.presentation;
  const meta: string[] = [];
  if (presentation?.lineRange !== undefined && presentation.lineRange.length > 0) {
    meta.push(presentation.lineRange);
  }
  if (presentation?.countTag !== undefined && presentation.countTag.length > 0) {
    meta.push(presentation.countTag);
  }
  const durationMs = presentation?.durationMs ?? tool.durationMs;
  if (tool.status !== 'running' && typeof durationMs === 'number' && durationMs >= 0) {
    meta.push(formatToolDuration(durationMs));
  }
  return meta;
}

export function formatToolDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.max(1, Math.round(ms))}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds - minutes * 60)}s`;
}

function resolveArgChip(
  command: string | undefined,
  targetPaths: readonly string[],
  summary: string | undefined,
): string | undefined {
  if (command !== undefined && command.trim().length > 0) {
    return firstLine(command);
  }
  const firstPath = targetPaths[0];
  if (firstPath !== undefined && firstPath.length > 0) {
    const chip = shortenPath(firstPath);
    return targetPaths.length > 1 ? `${chip} +${targetPaths.length - 1}` : chip;
  }
  if (summary === undefined || summary.trim().length === 0 || looksLikeArgsDump(summary)) {
    return undefined;
  }
  return firstLine(summary);
}

/** Keep the file name visible: ellipsis must eat the directory, not the basename. */
export function shortenPath(path: string): string {
  if (path.length <= MAX_PATH_CHIP) {
    return path;
  }
  const segments = path.split('/').filter((segment) => segment.length > 0);
  const tail = segments.slice(-2).join('/');
  return tail.length + 2 <= MAX_PATH_CHIP ? `…/${tail}` : `…/${segments[segments.length - 1] ?? tail}`;
}

function firstLine(text: string): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

function looksLikeArgsDump(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function isQuestionTool(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === 'questionnaire' || lower === 'ask_user' || lower === 'ask_user_question';
}

/**
 * The Host bounds `inputPreview`, so the JSON is usually cut mid-string; read
 * the first `prompt`/`question` field with a tolerant scan instead of parse.
 */
export function readQuestionPrompt(preview: string | undefined): string | undefined {
  return readJsonStringField(preview, ['prompt', 'question', 'title']);
}

/** First string value for any of `keys`; tolerates a preview cut mid-document. */
export function readJsonStringField(preview: string | undefined, keys: readonly string[]): string | undefined {
  if (preview === undefined) {
    return undefined;
  }
  const pattern = new RegExp(`"(?:${keys.join('|')})"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`);
  const match = pattern.exec(preview);
  const raw = match?.[1];
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
}
