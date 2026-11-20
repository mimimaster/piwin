/**
 * Mistral `/v1/chat/completions` wire adapter.
 *
 * Mistral's OpenAI-compatible endpoint differs from OpenAI/DeepSeek in two ways:
 * 1. When reasoning is active, streaming `delta.content` can arrive as an array
 *    of typed content chunks (`{ type: "thinking", thinking: [{ type: "text", text }] }`,
 *    `{ type: "text", text }`), which Pi's `openai-completions` concatenates into
 *    `"[object Object]"`.
 * 2. Multi-turn requests strictly reject output-only reasoning fields
 *    (`reasoning_content`, `reasoning`, `reasoning_text`) inside historical
 *    `assistant` messages with HTTP 422 (`extra_forbidden`).
 *
 * This wrapper sanitizes outbound assistant history via `onPayload` and
 * normalizes inbound SSE chunks via `options.fetch` so Pi receives clean
 * `reasoning_content` followed by `content` deltas.
 */
import type { FetchLike } from './native-search-tee.js';
import type { NativeSearchStreamOptions, NativeSearchStreamSimple } from './native-web-search.js';

export const MISTRAL_MODEL_ID_PREFIXES = [
  'mistral',
  'mixtral',
  'codestral',
  'devstral',
  'magistral',
  'pixtral',
  'ministral',
  'open-mistral',
  'open-mixtral',
] as const;

const ASSISTANT_REASONING_KEYS = ['reasoning_content', 'reasoning', 'reasoning_text'] as const;

export type MistralOpenAiModelFlags = {
  id: string;
  baseUrl?: string;
};

export function isMistralBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    return new URL(baseUrl).hostname.toLowerCase() === 'api.mistral.ai';
  } catch {
    return baseUrl.toLowerCase().includes('api.mistral.ai');
  }
}

export function isMistralModelId(modelId: string): boolean {
  const trimmed = modelId.trim().toLowerCase();
  const slash = trimmed.lastIndexOf('/');
  const modelName = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
  return MISTRAL_MODEL_ID_PREFIXES.some((prefix) => modelName.startsWith(prefix));
}

export function isMistralOpenAiTarget(modelId: string, baseUrl: string | undefined): boolean {
  return isMistralBaseUrl(baseUrl) || isMistralModelId(modelId);
}

/**
 * Strip replayed `reasoning_content` / `reasoning` / `reasoning_text` keys from
 * historical `assistant` messages so Mistral strict schema validation accepts
 * multi-turn requests. Does not mutate the input payload.
 */
export function sanitizeMistralOpenAiPayload(payload: unknown): unknown {
  if (!isPlainObject(payload) || !Array.isArray(payload.messages)) {
    return payload;
  }
  let changed = false;
  const nextMessages = payload.messages.map((message) => {
    if (!isPlainObject(message) || message.role !== 'assistant') {
      return message;
    }
    const hasReasoningKey = ASSISTANT_REASONING_KEYS.some((key) =>
      Object.prototype.hasOwnProperty.call(message, key),
    );
    if (!hasReasoningKey) {
      return message;
    }
    changed = true;
    return omitKeys(message, ASSISTANT_REASONING_KEYS);
  });
  return changed ? { ...payload, messages: nextMessages } : payload;
}

type ExtractedChoice =
  | { kind: 'passthrough'; choice: unknown }
  | {
      kind: 'extracted';
      choice: Record<string, unknown>;
      delta: Record<string, unknown>;
      thinkingText: string;
      textContent: string;
    };

/**
 * Normalize one SSE `data:` JSON payload when any choice carries an array
 * `delta.content`. Returns `undefined` when no rewrite is needed, 1 JSON string
 * for single-phase chunks, or 2 JSON strings when thinking and text share one
 * transition chunk (emitting `reasoning_content` before `content` because Pi
 * reads `delta.content` before `delta.reasoning_content`).
 */
export function normalizeMistralSseDataLine(data: string): string[] | undefined {
  const trimmed = data.trim();
  if (trimmed.length === 0 || trimmed === '[DONE]') {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!isPlainObject(parsed) || !Array.isArray(parsed.choices)) {
    return undefined;
  }

  let hasArrayContent = false;
  let hasMixedThinkingAndText = false;
  const analyzed: ExtractedChoice[] = parsed.choices.map((choice) => {
    if (
      !isPlainObject(choice) ||
      !isPlainObject(choice.delta) ||
      !Array.isArray(choice.delta.content)
    ) {
      return { kind: 'passthrough', choice };
    }
    hasArrayContent = true;
    const { thinkingText, textContent } = extractDeltaContentParts(choice.delta.content);
    if (thinkingText.length > 0 && textContent.length > 0) {
      hasMixedThinkingAndText = true;
    }
    return {
      kind: 'extracted',
      choice,
      delta: choice.delta,
      thinkingText,
      textContent,
    };
  });

  if (!hasArrayContent) {
    return undefined;
  }

  if (hasMixedThinkingAndText) {
    return buildSplitTransitionChunks(parsed, analyzed);
  }
  return [JSON.stringify({ ...parsed, choices: buildSinglePhaseChoices(analyzed) })];
}

function buildSplitTransitionChunks(
  parsed: Record<string, unknown>,
  analyzed: readonly ExtractedChoice[],
): string[] {
  const topWithoutUsage = omitKeys(parsed, ['usage']);
  const thinkingChoices = analyzed.map((entry) => {
    if (entry.kind === 'passthrough') {
      return isPlainObject(entry.choice)
        ? { ...entry.choice, delta: {}, finish_reason: null }
        : entry.choice;
    }
    if (entry.thinkingText.length === 0) {
      return { ...entry.choice, delta: {}, finish_reason: null };
    }
    const deltaBase = omitKeys(entry.delta, ['content', 'tool_calls']);
    const existingReasoning =
      typeof entry.delta.reasoning_content === 'string' ? entry.delta.reasoning_content : '';
    return {
      ...entry.choice,
      delta: {
        ...deltaBase,
        content: null,
        reasoning_content: `${existingReasoning}${entry.thinkingText}`,
      },
      finish_reason: null,
    };
  });
  const textChoices = analyzed.map((entry) => {
    if (entry.kind === 'passthrough') {
      return entry.choice;
    }
    if (entry.textContent.length === 0) {
      return { ...entry.choice, delta: {} };
    }
    const deltaBase = omitKeys(entry.delta, ['reasoning_content']);
    return {
      ...entry.choice,
      delta: {
        ...deltaBase,
        content: entry.textContent,
      },
    };
  });
  return [
    JSON.stringify({ ...topWithoutUsage, choices: thinkingChoices }),
    JSON.stringify({ ...parsed, choices: textChoices }),
  ];
}

function buildSinglePhaseChoices(analyzed: readonly ExtractedChoice[]): unknown[] {
  return analyzed.map((entry) => {
    if (entry.kind === 'passthrough') {
      return entry.choice;
    }
    const deltaBase = omitKeys(entry.delta, ['content']);
    if (entry.thinkingText.length > 0) {
      const existingReasoning =
        typeof entry.delta.reasoning_content === 'string' ? entry.delta.reasoning_content : '';
      return {
        ...entry.choice,
        delta: {
          ...deltaBase,
          content: null,
          reasoning_content: `${existingReasoning}${entry.thinkingText}`,
        },
      };
    }
    if (entry.textContent.length > 0) {
      return {
        ...entry.choice,
        delta: {
          ...deltaBase,
          content: entry.textContent,
        },
      };
    }
    return {
      ...entry.choice,
      delta: {
        ...deltaBase,
        content: null,
      },
    };
  });
}

function extractDeltaContentParts(items: readonly unknown[]): {
  thinkingText: string;
  textContent: string;
} {
  const thinkingParts: string[] = [];
  const textParts: string[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      if (item.length > 0) textParts.push(item);
      continue;
    }
    if (!isPlainObject(item)) {
      continue;
    }
    if (item.type === 'thinking') {
      collectThinkingText(item, thinkingParts);
      continue;
    }
    if (item.type === 'text' && typeof item.text === 'string' && item.text.length > 0) {
      textParts.push(item.text);
    }
  }
  return {
    thinkingText: thinkingParts.join(''),
    textContent: textParts.join(''),
  };
}

function collectThinkingText(item: Record<string, unknown>, target: string[]): void {
  if (Array.isArray(item.thinking)) {
    for (const part of item.thinking) {
      if (isPlainObject(part) && typeof part.text === 'string' && part.text.length > 0) {
        target.push(part.text);
      }
    }
    return;
  }
  if (typeof item.thinking === 'string' && item.thinking.length > 0) {
    target.push(item.thinking);
    return;
  }
  if (typeof item.text === 'string' && item.text.length > 0) {
    target.push(item.text);
  }
}

function formatNormalizedSseLine(rawLine: string, isFlush: boolean): string {
  const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
  if (!line.startsWith('data:')) {
    return isFlush ? rawLine : `${rawLine}\n`;
  }
  const afterPrefix = line.slice(5);
  const payload = afterPrefix.startsWith(' ') ? afterPrefix.slice(1) : afterPrefix;
  const normalized = normalizeMistralSseDataLine(payload);
  if (!normalized) {
    return isFlush ? rawLine : `${rawLine}\n`;
  }
  if (isFlush) {
    return normalized.map((item) => `data: ${item}\n\n`).join('');
  }
  if (normalized.length === 1) {
    return `data: ${normalized[0]}\n`;
  }
  return normalized.map((item) => `data: ${item}\n`).join('\n');
}

/**
 * Wrap `fetch` so `text/event-stream` responses from Mistral normalize array
 * `delta.content` chunks into standard OpenAI `reasoning_content` / `content`
 * SSE lines before the OpenAI SDK parses them.
 */
export function createMistralSseFetch(baseFetch: FetchLike = globalThis.fetch): FetchLike {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (!response.ok || !response.body) {
      return response;
    }
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.includes('text/event-stream')) {
      return response;
    }

    const decoder = new TextDecoder('utf-8');
    const encoder = new TextEncoder();
    let buffer = '';

    const transformed = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller): void {
          buffer += decoder.decode(chunk, { stream: true });
          let newlineIndex = buffer.indexOf('\n');
          while (newlineIndex !== -1) {
            const rawLine = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);
            controller.enqueue(encoder.encode(formatNormalizedSseLine(rawLine, false)));
            newlineIndex = buffer.indexOf('\n');
          }
        },
        flush(controller): void {
          buffer += decoder.decode();
          if (buffer.length > 0) {
            controller.enqueue(encoder.encode(formatNormalizedSseLine(buffer, true)));
            buffer = '';
          }
        },
      }),
    );

    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(transformed, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

/**
 * Wrap `streamSimple` so requests targeting Mistral OpenAI-compatible endpoints
 * strip historical assistant reasoning fields and normalize streaming SSE chunks.
 */
export function wrapStreamSimpleForMistralOpenAi(
  baseStreamSimple: NativeSearchStreamSimple | undefined,
  options: {
    models?: readonly MistralOpenAiModelFlags[];
    fallbackStreamSimple?: NativeSearchStreamSimple;
  } = {},
): NativeSearchStreamSimple | undefined {
  const underlying = baseStreamSimple ?? options.fallbackStreamSimple;
  if (!underlying) {
    return undefined;
  }
  const baseUrlById = new Map<string, string>();
  for (const model of options.models ?? []) {
    if (model.baseUrl) {
      baseUrlById.set(model.id, model.baseUrl);
    }
  }

  return (model, context, streamOptions) => {
    const modelId = typeof model?.id === 'string' ? model.id : '';
    const modelBaseUrl =
      typeof model?.baseUrl === 'string' && model.baseUrl.length > 0
        ? model.baseUrl
        : modelId
          ? baseUrlById.get(modelId)
          : undefined;
    if (!isMistralOpenAiTarget(modelId, modelBaseUrl)) {
      return underlying(model, context, streamOptions);
    }

    const previousOnPayload = streamOptions?.onPayload;
    const upstreamFetch: FetchLike =
      typeof streamOptions?.fetch === 'function'
        ? (streamOptions.fetch as FetchLike)
        : (input, init) => globalThis.fetch(input, init);

    const nextOptions: NativeSearchStreamOptions = {
      ...(streamOptions ?? {}),
      fetch: createMistralSseFetch(upstreamFetch),
      onPayload: async (payload, payloadModel) => {
        let nextPayload = payload;
        if (previousOnPayload) {
          const replaced = await previousOnPayload(payload, payloadModel);
          if (replaced !== undefined) {
            nextPayload = replaced;
          }
        }
        return sanitizeMistralOpenAiPayload(nextPayload);
      },
    };
    return underlying(model, context, nextOptions);
  };
}

function omitKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const result = { ...record };
  for (const key of keys) {
    delete result[key];
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
