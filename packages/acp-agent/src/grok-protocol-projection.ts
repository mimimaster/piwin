/**
 * Grok permission request / usage / catalog projections (ADR 0082).
 */

import type {
  BackendPermissionOption,
  PermissionRequestContext,
  PermissionRiskKind,
} from '@piwin/contracts';
import { isBackendPermissionOptionKind } from '@piwin/contracts';
import type { XaiSessionEntry } from './acp-protocol-types.js';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export type GrokPermissionPrompt = {
  toolCallId?: string;
  action: string;
  detail: string;
  context: PermissionRequestContext;
  options: BackendPermissionOption[];
};

function riskKindFor(acpKind: string | undefined): PermissionRiskKind {
  switch (acpKind) {
    case 'execute':
      return 'command';
    case 'edit':
    case 'delete':
    case 'move':
      return 'file-write';
    case 'fetch':
      return 'network';
    default:
      return 'unknown';
  }
}

/** Project `session/request_permission` params; undefined when no usable option exists. */
export function parseGrokPermissionRequest(
  params: unknown,
  agentId: string,
): GrokPermissionPrompt | undefined {
  const record = asRecord(params);
  if (record === undefined || !Array.isArray(record.options)) {
    return undefined;
  }
  const options: BackendPermissionOption[] = [];
  for (const entry of record.options) {
    const option = asRecord(entry);
    const optionId = readString(option, 'optionId');
    const kind = option?.kind;
    if (optionId === undefined || !isBackendPermissionOptionKind(kind)) {
      continue;
    }
    options.push({ optionId, kind, label: readString(option, 'name') ?? optionId });
  }
  if (options.length === 0) {
    return undefined;
  }
  const toolCall = asRecord(record.toolCall);
  const acpKind = readString(toolCall, 'kind');
  const title = readString(toolCall, 'title') ?? 'Grok wants to run a tool';
  const rawInput = asRecord(toolCall?.rawInput);
  const command = readString(rawInput, 'command');
  const paths: string[] = [];
  for (const key of ['path', 'file_path', 'filePath']) {
    const path = readString(rawInput, key);
    if (path !== undefined) {
      paths.push(path);
    }
  }
  if (Array.isArray(toolCall?.locations)) {
    for (const location of toolCall.locations) {
      const path = readString(asRecord(location), 'path');
      if (path !== undefined && !paths.includes(path)) {
        paths.push(path);
      }
    }
  }
  const context: PermissionRequestContext = {
    kind: riskKindFor(acpKind),
    summary: title,
    backendOptions: options,
    backendAgentId: agentId,
  };
  if (command !== undefined) {
    context.command = command;
  }
  if (paths.length > 0) {
    context.paths = paths;
  }
  const prompt: GrokPermissionPrompt = {
    action: acpKind ?? 'tool',
    detail: command ?? paths[0] ?? title,
    context,
    options,
  };
  const toolCallId = readString(toolCall, 'toolCallId');
  if (toolCallId !== undefined) {
    prompt.toolCallId = toolCallId;
  }
  return prompt;
}

export type GrokTurnUsage = {
  modelId?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  totalTokens: number;
  durationMs?: number;
};

function readNumber(record: Record<string, unknown> | undefined, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return undefined;
}

/** Parse `session/prompt` result `_meta.usage`; undefined when absent. */
export function parseGrokPromptUsage(meta: Record<string, unknown> | undefined): GrokTurnUsage | undefined {
  const usage = asRecord(meta?.usage);
  if (usage === undefined) {
    return undefined;
  }
  const inputTokens = readNumber(usage, ['inputTokens', 'input_tokens']);
  const outputTokens = readNumber(usage, ['outputTokens', 'output_tokens']);
  const cacheReadTokens = readNumber(usage, ['cachedReadTokens', 'cacheReadTokens', 'cached_read_tokens']);
  const cacheWriteTokens = readNumber(usage, ['cacheCreationTokens', 'cache_creation_tokens']);
  const reasoningTokens = readNumber(usage, ['reasoningTokens', 'reasoning_tokens']);
  const totalTokens =
    readNumber(usage, ['totalTokens', 'total_tokens']) ??
    (inputTokens ?? 0) + (outputTokens ?? 0);
  const result: GrokTurnUsage = { totalTokens };
  const modelId = readString(meta, 'modelId');
  if (modelId !== undefined) result.modelId = modelId;
  if (inputTokens !== undefined) result.inputTokens = inputTokens;
  if (outputTokens !== undefined) result.outputTokens = outputTokens;
  if (cacheReadTokens !== undefined) result.cacheReadTokens = cacheReadTokens;
  if (cacheWriteTokens !== undefined) result.cacheWriteTokens = cacheWriteTokens;
  if (reasoningTokens !== undefined) result.reasoningTokens = reasoningTokens;
  const durationMs = readNumber(usage, ['apiDurationMs', 'durationMs']);
  if (durationMs !== undefined) result.durationMs = durationMs;
  return result;
}

/** Normalized Grok catalog entry for the product session index. */
export type GrokCatalogSession = {
  backendSessionId: string;
  title?: string;
  cwd?: string;
  activity?: string;
  isWorktree?: boolean;
  lastChangeUnixMs?: number;
  modelId?: string;
  autoApprove?: boolean;
  originKind?: string;
};

/** Title may be a string or `{ text }` / `{ value }` object depending on source. */
function catalogTitle(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.trim() === '' ? undefined : value.trim();
  }
  const record = asRecord(value);
  const text = readString(record, 'text') ?? readString(record, 'value') ?? readString(record, 'title');
  return text?.trim() === '' ? undefined : text?.trim();
}

export function projectGrokCatalogEntry(entry: XaiSessionEntry): GrokCatalogSession {
  const session: GrokCatalogSession = { backendSessionId: entry.sessionId };
  const title = catalogTitle(entry.title);
  if (title !== undefined) session.title = title;
  if (entry.cwd !== undefined) session.cwd = entry.cwd;
  if (entry.activity !== undefined) session.activity = entry.activity;
  if (entry.isWorktree !== undefined) session.isWorktree = entry.isWorktree;
  if (entry.lastChangeUnixMs !== undefined) session.lastChangeUnixMs = entry.lastChangeUnixMs;
  if (entry.modelId !== undefined) session.modelId = entry.modelId;
  if (entry.yolo !== undefined) session.autoApprove = entry.yolo;
  if (entry.origin?.kind !== undefined) session.originKind = entry.origin.kind;
  return session;
}

/**
 * Terminal classification for a Grok `stopReason`. `cancelled` after a
 * rejected permission is a rejection, not a user stop.
 */
export type GrokTurnTerminal =
  | { status: 'completed'; stopReason: 'stop' | 'length' }
  | { status: 'aborted'; reason: 'user-cancelled' | 'permission-rejected' }
  | { status: 'failed'; message: string };

export function classifyGrokStopReason(
  stopReason: string,
  context: { userCancelled: boolean; permissionRejected: boolean },
): GrokTurnTerminal {
  switch (stopReason) {
    case 'end_turn':
      return { status: 'completed', stopReason: 'stop' };
    case 'max_tokens':
    case 'max_turn_requests':
    case 'max_turns':
      return { status: 'completed', stopReason: 'length' };
    case 'cancelled':
      if (context.permissionRejected && !context.userCancelled) {
        return { status: 'aborted', reason: 'permission-rejected' };
      }
      return { status: 'aborted', reason: 'user-cancelled' };
    case 'refusal':
      return { status: 'failed', message: 'Grok refused the request' };
    default:
      return { status: 'failed', message: `Grok stopped: ${stopReason}` };
  }
}
