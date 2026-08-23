/**
 * Pure head-row presentation logic for tool-call cards: verb fallbacks,
 * summary recovery from legacy inputPreview payloads, and the collapsed
 * header preview policy. Kept free of JSX so the rules stay unit-testable.
 */
import type { ToolKind } from '@piwin/contracts';
import type { ToolCardUi } from './chat-reducer';

export function formatToolDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

export function toolHasExpandableBody(tool: ToolCardUi): boolean {
  const output = tool.presentation?.output?.text ?? tool.output;
  return Boolean(
    (typeof output === 'string' && output.length > 0) ||
      tool.presentation?.command ||
      tool.presentation?.inputPreview ||
      (tool.presentation?.targetPaths && tool.presentation.targetPaths.length > 0) ||
      (tool.presentation?.changedPaths && tool.presentation.changedPaths.length > 0) ||
      tool.presentation?.error,
  );
}

/** Fallback verb when host presentation is missing (legacy transcripts). */
export function kindVerb(kind: ToolKind | 'unknown', toolName: string): string {
  const name = toolName.toLowerCase();
  if (name === 'goal_complete') return 'Goal Completed';
  if (name === 'goal_blocked') return 'Goal Blocked';
  if (name === 'goal_wait') return 'Goal Waiting';
  if (name.includes('grep') || name.includes('search')) return 'Searched';
  if (name.includes('glob') || name.includes('list_dir') || name === 'ls') return 'Explored';
  if (name.includes('read') || name.includes('view')) return 'Read';
  if (name.includes('write') || name.includes('edit') || name.includes('replace')) return 'Edited';
  if (name.includes('test')) return 'Ran tests';
  if (name.includes('build') || name.includes('compile')) return 'Built';
  if (name.includes('bash') || name.includes('shell') || name.includes('command'))
    return 'Ran command';
  if (name.includes('git')) return 'Git';
  if (name.includes('fetch')) return 'Fetched';
  if (name.includes('image')) return 'Generated image';
  switch (kind) {
    case 'filesystem':
      return 'Read';
    case 'shell':
    case 'process':
      return 'Ran command';
    case 'git':
      return 'Git';
    case 'web':
      return 'Fetched';
    case 'mcp':
      return 'MCP';
    case 'image':
      return 'Generated image';
    case 'video':
      return 'Generated video';
    default:
      return toolName;
  }
}

/** True for shell commands that are acting as a fetch/request transcript. */
export function isFetchLikeShellCommand(command: string | undefined): boolean {
  if (!command) {
    return false;
  }
  return /(^|\s)(?:curl|wget|fetch)\b/i.test(command) || /^\s*#\s*fetch\b/im.test(command);
}

/** Use a leading shell comment or echo header as the human-readable title. */
export function extractCommandDescription(command: string | undefined): string | undefined {
  if (!command) {
    return undefined;
  }
  const comment = command.match(/^\s*#\s*(.+?)\s*$/m)?.[1];
  if (comment?.trim()) {
    return comment.trim();
  }
  const echoMatch = command.match(/^\s*echo\s+["'](?:===+\s*)?([^"'=\n]+?)(?:\s*===+)?["']/);
  if (echoMatch?.[1]?.trim()) {
    return echoMatch[1].trim();
  }
  return undefined;
}

/** Keep native web_fetch requests truthful while presenting them as code. */
export function resolveFetchRequestPreview(
  inputPreview: string | undefined,
  fallback: string,
): string {
  if (!inputPreview) {
    return fallback;
  }
  try {
    const parsed: unknown = JSON.parse(inputPreview);
    if (parsed && typeof parsed === 'object') {
      const url = (parsed as Record<string, unknown>).url;
      if (typeof url === 'string' && url.trim()) {
        return `GET ${url.trim()}`;
      }
    }
  } catch {
    // Legacy transcripts may store a non-JSON request preview.
  }
  return inputPreview;
}

/** True when a head summary is really a raw args/JSON dump, not a tool/query label. */
export function looksLikeArgsDumpSummary(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  // Full dumps end with }/]; clipSummary-truncated dumps keep the opening brace
  // but end with `…` / `...` and must still be suppressed in the tool title row.
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return true;
  }
  return false;
}

/**
 * Recover a human label from tool inputPreview when the stored summary is a
 * raw JSON dump (legacy image_gen presentations after tool/end overwrite).
 */
export function recoverSummaryFromInputPreview(
  inputPreview: string | undefined,
): string | undefined {
  if (!inputPreview) {
    return undefined;
  }
  const trimmed = inputPreview.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      for (const key of ['prompt', 'description', 'query', 'command', 'cmd']) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) {
          return clipHeaderSummary(value);
        }
      }
    }
  } catch {
    // inputPreview may itself be clipSummary-truncated and not valid JSON.
    // Best-effort: pull a quoted prompt/description field from the partial text.
    for (const key of ['prompt', 'description', 'query', 'command', 'cmd']) {
      const match = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`, 'i').exec(trimmed);
      const captured = match?.[1];
      if (captured && captured.trim()) {
        return clipHeaderSummary(captured.replace(/\\"/g, '"').replace(/\\n/g, ' '));
      }
    }
  }
  return undefined;
}

function clipHeaderSummary(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return compact;
  }
  return compact.length > 96 ? `${compact.slice(0, 95)}…` : compact;
}

/**
 * Collapsed MCP head: tool identity, plus a short arg snippet (query/prompt)
 * when one exists. Never dump raw JSON into the title row.
 */
export function resolveMcpHeaderPreview(input: {
  displayName: string;
  toolName: string;
  summary: string;
  inputPreview?: string;
}): string {
  const identity = mcpToolIdentity(input);
  const snippet = recoverSummaryFromInputPreview(input.inputPreview);
  if (!identity) {
    return snippet && !looksLikeArgsDumpSummary(snippet) ? snippet : '';
  }
  if (!snippet || snippet === identity || identity.includes(snippet)) {
    return identity;
  }
  return `${identity} · ${snippet}`;
}

function mcpToolIdentity(input: {
  displayName: string;
  toolName: string;
  summary: string;
}): string {
  const title = input.displayName.trim();
  if (title && title !== 'MCP gateway') {
    return title;
  }
  const summary = input.summary.trim();
  if (summary && !looksLikeArgsDumpSummary(summary)) {
    return summary;
  }
  const raw = input.toolName.trim();
  if (!raw || raw.toLowerCase() === 'mcp_gateway') {
    return '';
  }
  return raw.replace(/^mcp__?/i, '').replace(/__/g, ' / ').trim();
}

/**
 * Header mono preview (query / command / path summary).
 * Detail payloads (shell command / MCP args) are shown only while collapsed —
 * expanded body already owns the full detail block.
 */
export function resolveToolCallHeaderPreview(input: {
  summary: string;
  displayName: string;
  showFilePill: boolean;
  pillLabel: string;
  singleBasename: string;
  isPathLike: boolean;
  expanded: boolean;
  /** True when body will render command and/or inputPreview. */
  hasDetailInBody: boolean;
  /** True when summary is just a raw args dump (same text as inputPreview). */
  isArgsDumpSummary?: boolean;
  /**
   * MCP verbs are generic ("Called" / "已调用"); the title *is* the preview.
   * Keep a summary that repeats displayName in that case.
   */
  keepTitlePreview?: boolean;
}): string {
  const {
    summary,
    displayName,
    showFilePill,
    pillLabel,
    singleBasename,
    isPathLike,
    expanded,
    hasDetailInBody,
    isArgsDumpSummary = false,
    keepTitlePreview = false,
  } = input;
  if (!summary) return '';
  if (summary === displayName && !keepTitlePreview) return '';
  // Never promote raw JSON/args dumps into the title row (MCP legacy presentations).
  if (isArgsDumpSummary) return '';
  // Expanded body already renders the full detail — keep the head as verb-only
  // so long shell lines do not wrap into a multi-line "title". MCP identity is
  // short and is the only label besides the generic 调用/已调用 verb.
  if (expanded && hasDetailInBody && !keepTitlePreview) return '';
  if (showFilePill && pillLabel && (summary === pillLabel || summary === singleBasename)) {
    return '';
  }
  if (showFilePill && isPathLike) return '';
  return summary;
}
