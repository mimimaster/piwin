import type { ModelProviderConfig } from '@piwin/contracts';
import { StructuredCompletionError } from './structured-completion-error.js';

export type StructuredCompletionRequest = {
  provider: ModelProviderConfig;
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  jsonSchema?: Record<string, unknown>;
  schemaName?: string;
  temperature: number;
  maxOutputTokens: number;
  signal: AbortSignal;
  timeoutMs?: number;
  /** Used in user-facing error text. Default "Structured". */
  label?: string;
};

export function completionLabel(request: { label?: string }): string {
  return request.label ?? 'Structured';
}

export function buildCompletionEndpoint(
  provider: ModelProviderConfig,
  modelId: string,
  label: string,
): string {
  const baseUrl = provider.baseUrl.trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new StructuredCompletionError(
      'provider-request-failed',
      `${label} completion requires a Base URL`,
    );
  }
  if (provider.protocol === 'google-gemini') {
    return `${baseUrl}/models/${encodeURIComponent(modelId)}:generateContent`;
  }
  if (provider.protocol === 'anthropic-compatible') {
    return baseUrl.endsWith('/v1') ? `${baseUrl}/messages` : `${baseUrl}/v1/messages`;
  }
  return baseUrl.endsWith('/v1') ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
}

export function buildCompletionBody(request: StructuredCompletionRequest): Record<string, unknown> {
  const { provider, modelId, systemPrompt, userPrompt, maxOutputTokens, temperature } = request;
  const schemaHint = request.jsonSchema
    ? `\n\nReturn JSON only that matches this schema:\n${JSON.stringify(request.jsonSchema)}`
    : '';
  const system = `${systemPrompt}${schemaHint}`;
  if (provider.protocol === 'google-gemini') {
    const generationConfig: Record<string, unknown> = {
      maxOutputTokens,
      temperature,
    };
    if (request.jsonSchema) {
      generationConfig.responseMimeType = 'application/json';
    }
    return {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig,
    };
  }
  if (provider.protocol === 'anthropic-compatible') {
    return {
      model: modelId,
      system,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: maxOutputTokens,
      temperature,
    };
  }
  const body: Record<string, unknown> = {
    model: modelId,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: maxOutputTokens,
    temperature,
    stream: false,
  };
  if (request.jsonSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: request.schemaName ?? 'result',
        schema: request.jsonSchema,
        strict: false,
      },
    };
  }
  return body;
}

export function parseCompletionResponse(
  protocol: ModelProviderConfig['protocol'],
  payload: unknown,
  label: string,
): string {
  if (!isRecord(payload)) {
    throw new StructuredCompletionError(
      'provider-request-failed',
      `${label} response was not a valid object`,
    );
  }
  if (protocol === 'google-gemini') return parseGeminiResponse(payload, label);
  if (protocol === 'anthropic-compatible') return parseAnthropicResponse(payload, label);
  return parseOpenAiResponse(payload, label);
}

function parseOpenAiResponse(payload: Record<string, unknown>, label: string): string {
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new StructuredCompletionError(
      'provider-request-failed',
      `${label} response did not contain a choice`,
    );
  }
  const firstChoice = choices[0];
  if (!isRecord(firstChoice)) {
    throw new StructuredCompletionError(
      'provider-request-failed',
      `${label} response choice was invalid`,
    );
  }
  const message = firstChoice.message;
  if (!isRecord(message)) {
    throw new StructuredCompletionError(
      'provider-request-failed',
      `${label} response message was invalid`,
    );
  }
  if (typeof message.content !== 'string') {
    throw new StructuredCompletionError(
      'provider-request-failed',
      `${label} response content was not text`,
    );
  }
  return message.content;
}

function parseAnthropicResponse(payload: Record<string, unknown>, label: string): string {
  const content = payload.content;
  if (!Array.isArray(content) || content.length === 0) {
    throw new StructuredCompletionError(
      'provider-request-failed',
      `${label} response did not contain content`,
    );
  }
  for (const block of content) {
    if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') {
      return block.text;
    }
  }
  throw new StructuredCompletionError(
    'provider-request-failed',
    `${label} response had no text content block`,
  );
}

function parseGeminiResponse(payload: Record<string, unknown>, label: string): string {
  const candidates = payload.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new StructuredCompletionError(
      'provider-request-failed',
      `${label} response did not contain a candidate`,
    );
  }
  const firstCandidate = candidates[0];
  if (!isRecord(firstCandidate)) {
    throw new StructuredCompletionError(
      'provider-request-failed',
      `${label} response candidate was invalid`,
    );
  }
  const content = firstCandidate.content;
  if (!isRecord(content)) {
    throw new StructuredCompletionError(
      'provider-request-failed',
      `${label} response content was invalid`,
    );
  }
  const parts = content.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new StructuredCompletionError(
      'provider-request-failed',
      `${label} response had no content parts`,
    );
  }
  let text = '';
  for (const part of parts) {
    if (isRecord(part) && typeof part.text === 'string') text += part.text;
  }
  return text;
}

export function extractJsonValue(raw: string): unknown {
  const objectStart = raw.indexOf('{');
  const arrayStart = raw.indexOf('[');
  const start =
    objectStart < 0 ? arrayStart : arrayStart < 0 ? objectStart : Math.min(objectStart, arrayStart);
  if (start < 0) return undefined;
  const closer = raw[start] === '[' ? ']' : '}';
  const end = raw.lastIndexOf(closer);
  if (end < start) return undefined;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
