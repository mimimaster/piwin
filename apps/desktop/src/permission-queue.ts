/**
 * Ordered, requestId-deduped permission prompts. Desktop used to keep a single
 * slot; concurrent Host requests overwrote each other and left tools hanging.
 */
import type { PermissionDecision } from '@piwin/contracts';
import type { ChatUiState, PermissionPromptUi, SubagentStreamState } from './chat-ui-types';

export const MAX_PERMISSION_QUEUE = 16;

export function activePermissionPrompt(
  queue: readonly PermissionPromptUi[],
): PermissionPromptUi | null {
  return queue[0] ?? null;
}

export function permissionQueueFields(
  queue: readonly PermissionPromptUi[],
): Pick<ChatUiState, 'permissionQueue' | 'permissionPrompt'> {
  const nextQueue =
    queue.length > MAX_PERMISSION_QUEUE ? queue.slice(0, MAX_PERMISSION_QUEUE) : [...queue];
  return {
    permissionQueue: nextQueue,
    permissionPrompt: nextQueue[0] ?? null,
  };
}

export function enqueuePermissionPrompt(
  queue: readonly PermissionPromptUi[],
  prompt: PermissionPromptUi,
): PermissionPromptUi[] {
  if (queue.some((item) => item.requestId === prompt.requestId)) {
    return queue as PermissionPromptUi[];
  }
  if (queue.length >= MAX_PERMISSION_QUEUE) {
    return queue as PermissionPromptUi[];
  }
  return [...queue, prompt];
}

export function dequeuePermissionPrompt(
  queue: readonly PermissionPromptUi[],
  requestId: string,
): PermissionPromptUi[] {
  if (!queue.some((item) => item.requestId === requestId)) {
    return queue as PermissionPromptUi[];
  }
  return queue.filter((item) => item.requestId !== requestId);
}

export function dropPermissionPromptsForRun(
  queue: readonly PermissionPromptUi[],
  runId: string,
): PermissionPromptUi[] {
  if (!queue.some((item) => item.runId === runId)) {
    return queue as PermissionPromptUi[];
  }
  return queue.filter((item) => item.runId !== runId);
}

/**
 * Host is authority: drop local entries the Host no longer has, keep local
 * copies (they may carry richer `context`) when ids match, append newly
 * reported Host entries.
 */
export function reconcilePermissionQueue(
  local: readonly PermissionPromptUi[],
  remote: readonly PermissionPromptUi[],
): PermissionPromptUi[] {
  const remoteById = new Map(remote.map((item) => [item.requestId, item]));
  const kept: PermissionPromptUi[] = [];
  const seen = new Set<string>();
  for (const item of local) {
    if (remoteById.has(item.requestId)) {
      kept.push(item);
      seen.add(item.requestId);
    }
  }
  for (const item of remote) {
    if (!seen.has(item.requestId)) {
      kept.push(item);
    }
  }
  const capped =
    kept.length > MAX_PERMISSION_QUEUE ? kept.slice(0, MAX_PERMISSION_QUEUE) : kept;
  if (
    capped.length === local.length &&
    capped.every((item, index) => item.requestId === local[index]?.requestId)
  ) {
    return local as PermissionPromptUi[];
  }
  return capped;
}

export function streamPermissionQueue(
  stream: SubagentStreamState,
): PermissionPromptUi[] {
  if (stream.permissionQueue !== undefined) {
    return stream.permissionQueue;
  }
  return stream.permissionPrompt ? [stream.permissionPrompt] : [];
}

export function applyPermissionQueueToStream(
  stream: SubagentStreamState,
  queue: readonly PermissionPromptUi[],
): SubagentStreamState {
  const fields = permissionQueueFields(queue);
  return {
    ...stream,
    permissionQueue: fields.permissionQueue,
    permissionPrompt: fields.permissionPrompt,
  };
}

function isPermissionDecision(value: unknown): value is PermissionDecision {
  return value === 'allow' || value === 'deny' || value === 'ask';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parsePendingPermissionList(data: unknown): PermissionPromptUi[] {
  if (!isRecord(data) || !Array.isArray(data.permissions)) {
    return [];
  }
  const parsed: PermissionPromptUi[] = [];
  for (const item of data.permissions) {
    if (parsed.length >= MAX_PERMISSION_QUEUE) {
      break;
    }
    if (!isRecord(item)) {
      continue;
    }
    if (
      typeof item.requestId !== 'string' ||
      item.requestId.length === 0 ||
      typeof item.sessionId !== 'string' ||
      item.sessionId.length === 0 ||
      typeof item.action !== 'string' ||
      typeof item.detail !== 'string' ||
      !isPermissionDecision(item.defaultDecision)
    ) {
      continue;
    }
    const prompt: PermissionPromptUi = {
      requestId: item.requestId,
      sessionId: item.sessionId,
      action: item.action,
      detail: item.detail,
      defaultDecision: item.defaultDecision,
    };
    if (typeof item.runId === 'string' && item.runId.length > 0) {
      prompt.runId = item.runId;
    }
    parsed.push(prompt);
  }
  return parsed;
}
