/**
 * Grok tool-call projection: merges the three-phase ACP tool lifecycle
 * (`tool_call` → `tool_call_update` with kind/content → status updates) into
 * piwin `ToolPresentation` snapshots keyed by `toolCallId`.
 *
 * Observed Grok 1.0.41/1.0.44 shapes (probe evidence):
 * - `tool_call`: title is the raw tool name, no kind; `_meta['x.ai/tool']`
 *   carries `{ name, kind, namespace, label, read_only }`.
 * - first update: `kind` (`edit`, `execute`, ...), readable title, `content`
 *   (`diff` blocks with `path`, or `content` text blocks), `locations`.
 * - later updates: `status` `in_progress` → `completed` | `failed`, plus
 *   `rawOutput` (`exit_code`, `output`, `truncated`, `timed_out` for shell).
 */

import type { ToolKind, ToolPresentation } from '@piwin/contracts';

export type GrokToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export type GrokToolState = {
  toolCallId: string;
  /** Raw tool name from the first frame (`write`, `run_terminal_command`). */
  toolName: string;
  acpKind?: string;
  title?: string;
  status: GrokToolStatus;
  readOnly: boolean;
  paths: string[];
  changedPaths: string[];
  command?: string;
  outputText?: string;
  outputTruncated?: boolean;
  exitCode?: number | null;
  timedOut?: boolean;
  startedAt: string;
  endedAt?: string;
};

const MAX_OUTPUT_CHARS = 16_000;

/** Map an ACP ToolKind onto the piwin ToolKind vocabulary. */
export function mapAcpToolKind(acpKind: string | undefined): ToolKind {
  switch (acpKind) {
    case 'read':
    case 'edit':
    case 'delete':
    case 'move':
    case 'search':
      return 'filesystem';
    case 'execute':
      return 'shell';
    case 'fetch':
      return 'web';
    default:
      return 'other';
  }
}

/** Verb that drives the Desktop behavior classifier (`resolveToolBehaviorId`). */
function actionVerbFor(acpKind: string | undefined, done: boolean): string | undefined {
  switch (acpKind) {
    case 'edit':
      return done ? 'Edited' : 'Editing';
    case 'delete':
      return done ? 'Edited' : 'Editing';
    case 'move':
      return done ? 'Edited' : 'Editing';
    case 'read':
      return done ? 'Read' : 'Reading';
    case 'search':
      return done ? 'Searched' : 'Searching';
    case 'execute':
      return 'Ran command';
    case 'fetch':
      return done ? 'Fetched' : 'Fetching';
    default:
      return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function parseStatus(value: unknown): GrokToolStatus | undefined {
  return value === 'pending' ||
    value === 'in_progress' ||
    value === 'completed' ||
    value === 'failed'
    ? value
    : undefined;
}

function pushUnique(target: string[], value: string): void {
  if (!target.includes(value)) {
    target.push(value);
  }
}

function truncateOutput(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_OUTPUT_CHARS) {
    return { text, truncated: false };
  }
  return { text: text.slice(text.length - MAX_OUTPUT_CHARS), truncated: true };
}

/** Create state from a `tool_call` update. */
export function createGrokToolState(update: Record<string, unknown>, now: string): GrokToolState {
  const toolCallId = readString(update, 'toolCallId') ?? '';
  const meta = asRecord(asRecord(update._meta)?.['x.ai/tool']);
  const toolName = readString(meta, 'name') ?? readString(update, 'title') ?? 'tool';
  const state: GrokToolState = {
    toolCallId,
    toolName,
    status: parseStatus(update.status) ?? 'pending',
    readOnly: meta?.read_only === true,
    paths: [],
    changedPaths: [],
    startedAt: now,
  };
  applyGrokToolUpdate(state, update, now);
  return state;
}

/** Merge a `tool_call` / `tool_call_update` frame into existing state. */
export function applyGrokToolUpdate(
  state: GrokToolState,
  update: Record<string, unknown>,
  now: string,
): void {
  const kind = readString(update, 'kind');
  if (kind !== undefined) {
    state.acpKind = kind;
  }
  const title = readString(update, 'title');
  if (title !== undefined && title !== state.toolName) {
    state.title = title;
  }
  const status = parseStatus(update.status);
  if (status !== undefined) {
    state.status = status;
    if ((status === 'completed' || status === 'failed') && state.endedAt === undefined) {
      state.endedAt = now;
    }
  }
  const rawInput = asRecord(update.rawInput);
  const command = readString(rawInput, 'command') ?? readString(rawInput, 'cmd');
  if (command !== undefined) {
    state.command = command;
  }
  for (const key of ['path', 'file_path', 'filePath', 'target_file']) {
    const path = readString(rawInput, key);
    if (path !== undefined) {
      pushUnique(state.paths, path);
    }
  }
  if (Array.isArray(update.locations)) {
    for (const location of update.locations) {
      const path = readString(asRecord(location), 'path');
      if (path !== undefined) {
        pushUnique(state.paths, path);
      }
    }
  }
  if (Array.isArray(update.content)) {
    applyContent(state, update.content);
  }
  const rawOutput = asRecord(update.rawOutput);
  if (rawOutput !== undefined) {
    applyRawOutput(state, rawOutput);
  }
}

function applyContent(state: GrokToolState, content: readonly unknown[]): void {
  const texts: string[] = [];
  for (const item of content) {
    const block = asRecord(item);
    if (block === undefined) {
      continue;
    }
    if (block.type === 'diff') {
      const path = readString(block, 'path');
      if (path !== undefined) {
        pushUnique(state.paths, path);
        pushUnique(state.changedPaths, path);
      }
      continue;
    }
    if (block.type === 'content') {
      const inner = asRecord(block.content);
      const text = readString(inner, 'text');
      if (text !== undefined) {
        texts.push(text);
      }
    }
  }
  if (texts.length > 0 && state.outputText === undefined) {
    const joined = truncateOutput(texts.join('\n'));
    state.outputText = joined.text;
    state.outputTruncated = joined.truncated;
  }
}

function applyRawOutput(state: GrokToolState, rawOutput: Record<string, unknown>): void {
  const exitCode = rawOutput.exit_code;
  if (typeof exitCode === 'number' || exitCode === null) {
    state.exitCode = exitCode;
  }
  if (rawOutput.timed_out === true) {
    state.timedOut = true;
  }
  const output = readString(rawOutput, 'output');
  if (output !== undefined) {
    const truncated = truncateOutput(output);
    state.outputText = truncated.text;
    state.outputTruncated = truncated.truncated || rawOutput.truncated === true;
  }
  const edits = asRecord(rawOutput.EditsApplied);
  const editedPath = readString(edits, 'path') ?? readString(edits, 'file_path');
  if (editedPath !== undefined) {
    pushUnique(state.changedPaths, editedPath);
  }
}

export function isGrokToolTerminal(state: GrokToolState): boolean {
  return state.status === 'completed' || state.status === 'failed';
}

/** Current display snapshot for a tool call. */
export function presentGrokTool(state: GrokToolState): ToolPresentation {
  const done = isGrokToolTerminal(state);
  const presentation: ToolPresentation = {
    kind: mapAcpToolKind(state.acpKind),
    title: state.title ?? state.toolName,
    startedAt: state.startedAt,
  };
  const verb = actionVerbFor(state.acpKind, done);
  if (verb !== undefined) {
    presentation.actionVerb = verb;
  }
  if (state.command !== undefined) {
    presentation.command = state.command;
  }
  if (state.paths.length > 0) {
    presentation.targetPaths = [...state.paths];
  }
  if (state.changedPaths.length > 0) {
    presentation.changedPaths = [...state.changedPaths];
  }
  if (state.exitCode !== undefined) {
    presentation.exitCode = state.exitCode;
  }
  if (state.outputText !== undefined) {
    presentation.output = {
      text: state.outputText,
      ...(state.outputTruncated === true ? { truncated: true } : {}),
    };
  }
  if (state.endedAt !== undefined) {
    presentation.endedAt = state.endedAt;
    const duration = Date.parse(state.endedAt) - Date.parse(state.startedAt);
    if (Number.isFinite(duration) && duration >= 0) {
      presentation.durationMs = duration;
    }
  }
  if (state.status === 'failed') {
    presentation.error = {
      category: state.timedOut === true ? 'timeout' : 'execution',
      message:
        state.timedOut === true
          ? 'Command timed out'
          : state.exitCode !== undefined && state.exitCode !== null
            ? `Exited with code ${state.exitCode}`
            : 'Tool failed',
    };
  }
  return presentation;
}
