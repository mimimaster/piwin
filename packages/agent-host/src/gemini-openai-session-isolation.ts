/**
 * Keep Gemini OpenAI-compat requests legal for Antigravity/CPA → Google.
 *
 * Two independent failures produce the same 400
 * ("function call turn comes immediately after a user turn or after a
 * function response turn"):
 *
 * 1. Context overflow / compaction drops the oldest **user** turn (often a
 *    huge imported prompt) but leaves that turn's assistant/tool tail.
 *    CPA then translates those orphans into a Gemini `contents` array that
 *    **starts with functionCall** — Google rejects it immediately.
 * 2. CPA's reasoning replay keys a ledger off the first user text (or
 *    Session-Id / prompt_cache_key). After a completed text answer, replay
 *    can splice stale functionCalls onto the next prompt.
 *
 * This wrapper (1) drops leading assistant/tool orphans so the first
 * non-system message is a user, and (2) isolates the CPA ledger per user
 * turn via `prompt_cache_key` + `Session-Id`.
 */
import { createHash } from 'node:crypto';
import type { NativeSearchStreamOptions, NativeSearchStreamSimple } from './native-web-search.js';

const GEMINI_MODEL_ID = /gemini/i;
const SYSTEM_ROLES = new Set(['system', 'developer']);

export function isGeminiOpenAiCompatModelId(modelId: string): boolean {
  return GEMINI_MODEL_ID.test(modelId);
}

export function geminiOpenAiPromptCacheKey(messages: unknown): string | undefined {
  const lastUser = lastUserMessageText(messages);
  if (lastUser === undefined) return undefined;
  const userTurns = countUserMessages(messages);
  return createHash('sha256').update(`${userTurns}:${lastUser}`).digest('hex').slice(0, 16);
}

/**
 * Drop assistant/tool messages that appear before the first user.
 * Leading system/developer rows stay. History that never had a user is left
 * unchanged — we do not invent a turn.
 */
export function sanitizeGeminiOpenAiMessages(messages: unknown): unknown {
  if (!Array.isArray(messages)) return messages;
  const firstUser = messages.findIndex((message) => messageRole(message) === 'user');
  if (firstUser <= 0) return messages;
  let hasOrphans = false;
  const prefix: unknown[] = [];
  for (let index = 0; index < firstUser; index += 1) {
    const role = messageRole(messages[index]);
    if (role !== undefined && SYSTEM_ROLES.has(role)) {
      prefix.push(messages[index]);
      continue;
    }
    hasOrphans = true;
  }
  if (!hasOrphans) return messages;
  return [...prefix, ...messages.slice(firstUser)];
}

export function applyGeminiOpenAiSessionIsolation(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  const record = payload as Record<string, unknown>;
  const messages = sanitizeGeminiOpenAiMessages(record.messages);
  const key = geminiOpenAiPromptCacheKey(messages);
  if (key === undefined && messages === record.messages) {
    return payload;
  }
  const next: Record<string, unknown> = { ...record, messages };
  if (key !== undefined) {
    next.prompt_cache_key = key;
    next.session_id = key;
  }
  return next;
}

export function wrapStreamSimpleForGeminiOpenAiSession(
  baseStreamSimple: NativeSearchStreamSimple | undefined,
  options: { fallbackStreamSimple?: NativeSearchStreamSimple } = {},
): NativeSearchStreamSimple | undefined {
  const underlying = baseStreamSimple ?? options.fallbackStreamSimple;
  if (!underlying) return undefined;

  return (model, context, streamOptions) => {
    const modelId = typeof model?.id === 'string' ? model.id : undefined;
    if (!modelId || !isGeminiOpenAiCompatModelId(modelId)) {
      return underlying(model, context, streamOptions);
    }
    const previousOnPayload = streamOptions?.onPayload;
    const isolationKey = geminiOpenAiPromptCacheKey(
      sanitizeGeminiOpenAiMessages(contextMessages(context)),
    );
    const previousHeaders = readStreamHeaders(streamOptions);
    const nextOptions: NativeSearchStreamOptions = {
      ...(streamOptions ?? {}),
      ...(isolationKey
        ? {
            headers: {
              ...previousHeaders,
              'Session-Id': isolationKey,
              'X-Session-Affinity': isolationKey,
            },
          }
        : {}),
      onPayload: async (payload, payloadModel) => {
        let nextPayload = payload;
        if (previousOnPayload) {
          const replaced = await previousOnPayload(payload, payloadModel);
          if (replaced !== undefined) {
            nextPayload = replaced;
          }
        }
        return applyGeminiOpenAiSessionIsolation(nextPayload);
      },
    };
    return underlying(model, context, nextOptions);
  };
}

function contextMessages(context: unknown): unknown {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return undefined;
  }
  return (context as { messages?: unknown }).messages;
}

function readStreamHeaders(streamOptions: NativeSearchStreamOptions | undefined): Record<string, unknown> {
  const headers = streamOptions?.headers;
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    return {};
  }
  return { ...(headers as Record<string, unknown>) };
}

function messageRole(message: unknown): string | undefined {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return undefined;
  }
  const role = (message as { role?: unknown }).role;
  return typeof role === 'string' ? role : undefined;
}

function countUserMessages(messages: unknown): number {
  if (!Array.isArray(messages)) return 0;
  let count = 0;
  for (const message of messages) {
    if (messageRole(message) === 'user') count += 1;
  }
  return count;
}

function lastUserMessageText(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (messageRole(message) !== 'user') continue;
    const record = message as Record<string, unknown>;
    const text = flattenMessageText(record.content);
    return text.length > 0 ? text : undefined;
  }
  return undefined;
}

function flattenMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.text === 'string' && record.text.length > 0) {
      parts.push(record.text);
    }
  }
  return parts.join('\n');
}
