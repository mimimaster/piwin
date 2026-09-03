import type { AgentEvent } from '@piwin/contracts';
import { asRecord, readString } from './pi-event-read.js';

const TOOL_ARG_UPDATE_TYPES = new Set([
  'toolcall_delta',
  'tool_call',
  'tool_call_delta',
  'toolCall',
]);

export type AssistantToolArgProgress = {
  kind: 'snapshot' | 'delta';
  chars: number;
  toolName?: string;
};

export type ToolArgProgressAccumulator = {
  charsByMessageId: Map<string, number>;
  toolNameByMessageId: Map<string, string>;
};

export function createToolArgProgressAccumulator(): ToolArgProgressAccumulator {
  return {
    charsByMessageId: new Map(),
    toolNameByMessageId: new Map(),
  };
}

export function readAssistantToolArgProgress(
  assistantEvent: Record<string, unknown> | null,
): AssistantToolArgProgress | null {
  if (!assistantEvent) {
    return null;
  }
  const type = readString(assistantEvent.type);
  if (type === undefined || !TOOL_ARG_UPDATE_TYPES.has(type)) {
    return null;
  }
  const toolName = readAssistantToolName(assistantEvent);
  const snapshot = assistantEvent.arguments ?? assistantEvent.args;
  if (snapshot !== undefined && snapshot !== null) {
    const chars = stringifyChars(snapshot);
    if (chars === 0 && toolName === undefined) {
      return null;
    }
    return toolName === undefined
      ? { kind: 'snapshot', chars }
      : { kind: 'snapshot', chars, toolName };
  }
  const delta = assistantEvent.delta ?? assistantEvent.partialArgs;
  const chars = stringifyChars(delta);
  if (chars === 0 && toolName === undefined) {
    return null;
  }
  return toolName === undefined ? { kind: 'delta', chars } : { kind: 'delta', chars, toolName };
}

export function rewriteCumulativeToolArgProgress(
  event: Extract<AgentEvent, { type: 'message/tool_args_progress' }>,
  update: AssistantToolArgProgress | null,
  accumulator: ToolArgProgressAccumulator,
): Extract<AgentEvent, { type: 'message/tool_args_progress' }> {
  const previous = accumulator.charsByMessageId.get(event.messageId) ?? 0;
  const nextChars = update?.kind === 'snapshot' ? update.chars : previous + event.argumentCharCount;
  accumulator.charsByMessageId.set(event.messageId, nextChars);
  const toolName =
    update?.toolName ?? event.toolName ?? accumulator.toolNameByMessageId.get(event.messageId);
  if (toolName !== undefined) {
    accumulator.toolNameByMessageId.set(event.messageId, toolName);
  }
  return {
    ...event,
    argumentCharCount: nextChars,
    ...(toolName !== undefined ? { toolName } : {}),
  };
}

export function clearToolArgProgress(
  accumulator: ToolArgProgressAccumulator,
  messageId: string,
): void {
  accumulator.charsByMessageId.delete(messageId);
  accumulator.toolNameByMessageId.delete(messageId);
}

export function resetToolArgProgress(accumulator: ToolArgProgressAccumulator): void {
  accumulator.charsByMessageId.clear();
  accumulator.toolNameByMessageId.clear();
}

function readAssistantToolName(assistantEvent: Record<string, unknown>): string | undefined {
  const direct = trimToolName(
    readString(assistantEvent.name) ?? readString(assistantEvent.toolName),
  );
  if (direct !== undefined) {
    return direct;
  }
  const toolCall = asRecord(assistantEvent.toolCall) ?? asRecord(assistantEvent.tool_call);
  if (toolCall) {
    const nested = trimToolName(readString(toolCall.name) ?? readString(toolCall.toolName));
    if (nested !== undefined) {
      return nested;
    }
    const fn = asRecord(toolCall.function);
    const functionName = fn ? trimToolName(readString(fn.name)) : undefined;
    if (functionName !== undefined) {
      return functionName;
    }
  }
  const fn = asRecord(assistantEvent.function);
  return fn ? trimToolName(readString(fn.name)) : undefined;
}

function trimToolName(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function stringifyChars(value: unknown): number {
  if (value === undefined || value === null) {
    return 0;
  }
  if (typeof value === 'string') {
    return value.length;
  }
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}
