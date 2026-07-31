/**
 * Walkthrough provider completion (spec §10).
 *
 * A Pi-session-independent, non-streaming text completion service that supports
 * the three configured provider protocols (OpenAI-compatible, Anthropic-compatible,
 * Google Gemini). It reuses the existing provider auth/secret plumbing so the
 * Desktop never resolves or transmits credentials.
 *
 * Errors are thrown as {@link WalkthroughCompletionError} with a stable `name`
 * matching the {@link WalkthroughErrorCode} values defined in the contracts. The
 * raw provider response body is never surfaced in error messages.
 */
import type { ModelProviderConfig, WalkthroughErrorCode } from '@piwin/contracts';
import { buildProviderRequestHeaders } from './provider-model-discovery.js';
import { createSecretResolver } from './secret-resolver.js';

/** Default completion timeout (spec §10.3). */
const COMPLETION_TIMEOUT_MS = 60_000;

/** Maximum UTF-8 byte size for generated walkthrough output (spec §10.4). */
const MAX_OUTPUT_BYTES = 32 * 1024;

/** Suffix appended when generated output exceeds the byte cap. */
const OUTPUT_TRUNCATED_SUFFIX = '[output truncated]';

export type WalkthroughCompletionRequest = {
  provider: ModelProviderConfig;
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
  temperature: number;
  signal: AbortSignal;
};

export type WalkthroughCompletionResult = {
  text: string;
};

export type WalkthroughCompletionDependencies = {
  fetch?: typeof globalThis.fetch;
  /**
   * Returns the resolved secret, or null when the endpoint is explicitly
   * configured for no-auth (local gateway). When omitted, a default
   * {@link createSecretResolver} is used and a missing-but-configured key is
   * reported as `missing-credentials`.
   */
  resolveSecret?: (provider: ModelProviderConfig) => Promise<string | null>;
};

/**
 * Error thrown by {@link completeWalkthrough}. The `name` property is the stable
 * {@link WalkthroughErrorCode} string so callers can branch on it without
 * inspecting messages, and the raw provider body is never included.
 */
export class WalkthroughCompletionError extends Error {
  readonly code: WalkthroughErrorCode;

  constructor(code: WalkthroughErrorCode, message: string) {
    super(message);
    this.name = code;
    this.code = code;
  }
}

/**
 * Generate walkthrough text from a configured provider without creating a Pi
 * session. Throws {@link WalkthroughCompletionError} on any failure; never
 * returns null or swallows errors.
 */
export async function completeWalkthrough(
  request: WalkthroughCompletionRequest,
  dependencies: WalkthroughCompletionDependencies = {},
): Promise<WalkthroughCompletionResult> {
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  if (!fetchImplementation) {
    throw new WalkthroughCompletionError(
      'provider-request-failed',
      'Walkthrough completion is unavailable: fetch is not supported',
    );
  }

  const resolveSecret = createCompletionSecretResolver(dependencies.resolveSecret);
  const endpoint = buildCompletionEndpoint(request.provider, request.modelId);
  const headers = await buildProviderRequestHeaders(request.provider, resolveSecret);
  headers.set('content-type', 'application/json');
  const body = buildCompletionBody(request);

  // Combine the external cancel signal with an internal timeout signal. The
  // external signal wins (→ cancelled) when both fire; the timeout alone yields
  // provider-timeout.
  const externalSignal = request.signal;
  if (externalSignal.aborted) {
    throw new WalkthroughCompletionError('cancelled', 'Walkthrough generation was cancelled');
  }
  const timeoutController = new AbortController();
  const onExternalAbort = () => timeoutController.abort();
  externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  const timeout = setTimeout(() => timeoutController.abort(), COMPLETION_TIMEOUT_MS);

  try {
    const response = await fetchImplementation(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: timeoutController.signal,
    });
    if (!response.ok) {
      throw new WalkthroughCompletionError(
        'provider-request-failed',
        `Walkthrough generation failed (${response.status} ${response.statusText || 'request rejected'})`,
      );
    }
    const payload: unknown = await response.json();
    const rawText = parseCompletionResponse(request.provider.protocol, payload);
    const text = processOutput(rawText);
    return { text };
  } catch (error) {
    if (error instanceof WalkthroughCompletionError) {
      throw error;
    }
    if (externalSignal.aborted) {
      throw new WalkthroughCompletionError('cancelled', 'Walkthrough generation was cancelled');
    }
    if (timeoutController.signal.aborted) {
      throw new WalkthroughCompletionError(
        'provider-timeout',
        `Walkthrough generation timed out after ${Math.round(COMPLETION_TIMEOUT_MS / 1000)} seconds`,
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new WalkthroughCompletionError(
      'provider-request-failed',
      `Walkthrough generation failed: ${message}`,
    );
  } finally {
    clearTimeout(timeout);
    externalSignal.removeEventListener('abort', onExternalAbort);
  }
}

/* ------------------------------------------------------------------ */
/* Secret resolution                                                  */
/* ------------------------------------------------------------------ */

function createCompletionSecretResolver(
  injected: WalkthroughCompletionDependencies['resolveSecret'],
): (provider: ModelProviderConfig) => Promise<string | null> {
  if (injected) {
    return injected;
  }
  const resolver = createSecretResolver();
  return async (provider) => {
    const hasKeySource = Boolean(provider.apiKeyEnv?.trim() || provider.apiKeyRef?.trim());
    if (!hasKeySource) {
      // Explicitly no-auth local endpoint.
      return null;
    }
    try {
      return await resolver.resolveProviderSecret(provider);
    } catch {
      throw new WalkthroughCompletionError(
        'missing-credentials',
        `Provider ${provider.id}: API key is configured but could not be resolved.`,
      );
    }
  };
}

/* ------------------------------------------------------------------ */
/* Endpoint + body construction                                       */
/* ------------------------------------------------------------------ */

function buildCompletionEndpoint(provider: ModelProviderConfig, modelId: string): string {
  const baseUrl = provider.baseUrl.trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new WalkthroughCompletionError(
      'provider-request-failed',
      'Walkthrough completion requires a Base URL',
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

function buildCompletionBody(request: WalkthroughCompletionRequest): Record<string, unknown> {
  const { provider, modelId, systemPrompt, userPrompt, maxOutputTokens, temperature } = request;
  if (provider.protocol === 'google-gemini') {
    return {
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        maxOutputTokens,
        temperature,
      },
    };
  }
  if (provider.protocol === 'anthropic-compatible') {
    return {
      model: modelId,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: maxOutputTokens,
    };
  }
  return {
    model: modelId,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: maxOutputTokens,
    temperature,
    stream: false,
  };
}

/* ------------------------------------------------------------------ */
/* Response parsing                                                    */
/* ------------------------------------------------------------------ */

function parseCompletionResponse(
  protocol: ModelProviderConfig['protocol'],
  payload: unknown,
): string {
  if (!isRecord(payload)) {
    throw new WalkthroughCompletionError(
      'provider-request-failed',
      'Walkthrough response was not a valid object',
    );
  }
  if (protocol === 'google-gemini') {
    return parseGeminiResponse(payload);
  }
  if (protocol === 'anthropic-compatible') {
    return parseAnthropicResponse(payload);
  }
  return parseOpenAiResponse(payload);
}

function parseOpenAiResponse(payload: Record<string, unknown>): string {
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new WalkthroughCompletionError(
      'provider-request-failed',
      'Walkthrough response did not contain a choice',
    );
  }
  const firstChoice = choices[0];
  if (!isRecord(firstChoice)) {
    throw new WalkthroughCompletionError(
      'provider-request-failed',
      'Walkthrough response choice was invalid',
    );
  }
  const message = firstChoice.message;
  if (!isRecord(message)) {
    throw new WalkthroughCompletionError(
      'provider-request-failed',
      'Walkthrough response message was invalid',
    );
  }
  const content = message.content;
  if (typeof content !== 'string') {
    throw new WalkthroughCompletionError(
      'provider-request-failed',
      'Walkthrough response content was not text',
    );
  }
  return content;
}

function parseAnthropicResponse(payload: Record<string, unknown>): string {
  const content = payload.content;
  if (!Array.isArray(content) || content.length === 0) {
    throw new WalkthroughCompletionError(
      'provider-request-failed',
      'Walkthrough response did not contain content',
    );
  }
  for (const block of content) {
    if (!isRecord(block)) {
      continue;
    }
    if (block.type === 'text' && typeof block.text === 'string') {
      return block.text;
    }
  }
  throw new WalkthroughCompletionError(
    'provider-request-failed',
    'Walkthrough response had no text content block',
  );
}

function parseGeminiResponse(payload: Record<string, unknown>): string {
  const candidates = payload.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new WalkthroughCompletionError(
      'provider-request-failed',
      'Walkthrough response did not contain a candidate',
    );
  }
  const firstCandidate = candidates[0];
  if (!isRecord(firstCandidate)) {
    throw new WalkthroughCompletionError(
      'provider-request-failed',
      'Walkthrough response candidate was invalid',
    );
  }
  const content = firstCandidate.content;
  if (!isRecord(content)) {
    throw new WalkthroughCompletionError(
      'provider-request-failed',
      'Walkthrough response content was invalid',
    );
  }
  const parts = content.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new WalkthroughCompletionError(
      'provider-request-failed',
      'Walkthrough response had no content parts',
    );
  }
  let text = '';
  for (const part of parts) {
    if (isRecord(part) && typeof part.text === 'string') {
      text += part.text;
    }
  }
  return text;
}

/* ------------------------------------------------------------------ */
/* Output processing (spec §10.4)                                      */
/* ------------------------------------------------------------------ */

function processOutput(raw: string): string {
  // 1. trim
  let text = raw.trim();
  // 2. reject empty
  if (text.length === 0) {
    throw new WalkthroughCompletionError('empty-output', 'Walkthrough generation returned no text');
  }
  // 3. remove NUL characters
  text = text.replace(/\0/g, '');
  // 4-5. 32 KiB UTF-8 cap with truncation suffix
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  if (bytes.length <= MAX_OUTPUT_BYTES) {
    return text;
  }
  const suffixBytes = encoder.encode(OUTPUT_TRUNCATED_SUFFIX);
  const maxPrefixBytes = MAX_OUTPUT_BYTES - suffixBytes.length;
  // Walk back to a UTF-8 character boundary so we don't split a multi-byte rune.
  let end = maxPrefixBytes;
  while (end > 0) {
    const byte = bytes[end];
    if (byte === undefined) {
      break;
    }
    if ((byte & 0xc0) !== 0x80) {
      break;
    }
    end--;
  }
  const prefix = new TextDecoder().decode(bytes.subarray(0, end));
  return `${prefix}${OUTPUT_TRUNCATED_SUFFIX}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
