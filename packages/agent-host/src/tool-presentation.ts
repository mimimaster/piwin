/**
 * Pure host-side tool presentation builder.
 * Desktop must not re-classify tools from raw name strings when presentation is present.
 */
import type {
  ToolErrorView,
  ToolKind,
  ToolOutputView,
  ToolPresentation,
} from '@piwin/contracts';

const MAX_TOOL_OUTPUT_CHARS = 8_000;

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

/**
 * Classify known product tool names. Unknown / MCP-style names become `other`
 * or `mcp` without inventing filesystem/shell semantics from substrings alone.
 */
export function classifyToolKind(toolName: string): ToolKind {
  const normalized = toolName.trim().toLowerCase();
  if (!normalized) {
    return 'other';
  }
  if (normalized.startsWith('mcp__') || normalized.startsWith('mcp:')) {
    return 'mcp';
  }
  if (
    normalized === 'bash' ||
    normalized === 'shell' ||
    normalized === 'run_terminal_cmd' ||
    normalized === 'execute_command'
  ) {
    return 'shell';
  }
  if (
    normalized === 'read' ||
    normalized === 'write' ||
    normalized === 'edit' ||
    normalized === 'apply_patch' ||
    normalized === 'read_file' ||
    normalized === 'write_file' ||
    normalized === 'str_replace'
  ) {
    return 'filesystem';
  }
  if (normalized === 'git' || normalized.startsWith('git_')) {
    return 'git';
  }
  if (normalized === 'web_search' || normalized === 'web_fetch' || normalized.startsWith('web_')) {
    return 'web';
  }
  if (normalized === 'process' || normalized.startsWith('process_')) {
    return 'process';
  }
  return 'other';
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

/**
 * Build a ToolPresentation from known tool metadata. Does not invent fields
 * the provider did not supply.
 */
export function buildToolPresentation(input: BuildToolPresentationInput): ToolPresentation {
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

  const command = extractCommand(kind, input.args);
  if (command) {
    presentation.command = command;
  }

  const targetPaths = extractTargetPaths(kind, input.args);
  if (targetPaths && targetPaths.length > 0) {
    presentation.targetPaths = targetPaths;
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
    presentation.output = boundToolOutput(input.outputText);
    if (!presentation.summary) {
      presentation.summary = presentation.output.text.slice(0, 120).replace(/\s+/g, ' ').trim();
    }
  }

  if (input.isError) {
    const error: ToolErrorView = {
      category: 'execution',
      message: presentation.summary ?? 'Tool failed',
    };
    presentation.error = error;
  }

  if (!presentation.summary) {
    if (presentation.command) {
      presentation.summary = presentation.command;
    } else if (presentation.targetPaths && presentation.targetPaths.length > 0) {
      presentation.summary = presentation.targetPaths.join(', ');
    } else if (presentation.inputPreview) {
      presentation.summary = presentation.inputPreview;
    }
  }

  return presentation;
}

function humanizeToolTitle(toolName: string, kind: ToolKind): string {
  if (kind === 'mcp') {
    return toolName.replace(/^mcp__?/, '').replace(/__/g, ' / ') || toolName;
  }
  return toolName;
}

function formatArgsPreview(args: unknown): string | undefined {
  if (args === undefined || args === null) {
    return undefined;
  }
  if (typeof args === 'string') {
    const redacted = redactToolText(args);
    return redacted.text.slice(0, 240);
  }
  try {
    const serialized = JSON.stringify(args);
    const redacted = redactToolText(serialized);
    return redacted.text.slice(0, 240);
  } catch {
    return undefined;
  }
}

function extractCommand(kind: ToolKind, args: unknown): string | undefined {
  if (kind !== 'shell' && kind !== 'process') {
    return undefined;
  }
  if (!args || typeof args !== 'object') {
    return undefined;
  }
  const record = args as Record<string, unknown>;
  const command =
    readString(record.command) ??
    readString(record.cmd) ??
    readString(record.script);
  return command ? redactToolText(command).text : undefined;
}

function extractTargetPaths(kind: ToolKind, args: unknown): string[] | undefined {
  if (kind !== 'filesystem' && kind !== 'git') {
    return undefined;
  }
  if (!args || typeof args !== 'object') {
    return undefined;
  }
  const record = args as Record<string, unknown>;
  const paths: string[] = [];
  for (const key of ['path', 'file', 'file_path', 'filename', 'target']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      paths.push(value.trim());
    }
  }
  if (Array.isArray(record.paths)) {
    for (const item of record.paths) {
      if (typeof item === 'string' && item.trim()) {
        paths.push(item.trim());
      }
    }
  }
  return paths.length > 0 ? paths : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
