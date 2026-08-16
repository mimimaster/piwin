/**
 * Walkthrough provider completion (spec §10).
 *
 * Thin wrapper over structured completion so walkthrough-specific output
 * caps and WalkthroughCompletionError names stay unchanged.
 */
import type { ModelProviderConfig, WalkthroughErrorCode } from '@piwin/contracts';
import {
  completeStructuredText,
  StructuredCompletionError,
  type StructuredCompletionDependencies,
  type StructuredCompletionRequest,
} from './structured-completion.js';

const COMPLETION_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 32 * 1024;
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

export type WalkthroughCompletionDependencies = StructuredCompletionDependencies;

export class WalkthroughCompletionError extends Error {
  readonly code: WalkthroughErrorCode;

  constructor(code: WalkthroughErrorCode, message: string) {
    super(message);
    this.name = code;
    this.code = code;
  }
}

export async function completeWalkthrough(
  request: WalkthroughCompletionRequest,
  dependencies: WalkthroughCompletionDependencies = {},
): Promise<WalkthroughCompletionResult> {
  const structured: StructuredCompletionRequest = {
    provider: request.provider,
    modelId: request.modelId,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    maxOutputTokens: request.maxOutputTokens,
    temperature: request.temperature,
    signal: request.signal,
    timeoutMs: COMPLETION_TIMEOUT_MS,
    label: 'Walkthrough',
  };
  try {
    const result = await completeStructuredText(structured, dependencies);
    return { text: processOutput(result.text) };
  } catch (error) {
    throw toWalkthroughError(error);
  }
}

function toWalkthroughError(error: unknown): WalkthroughCompletionError {
  if (error instanceof WalkthroughCompletionError) return error;
  if (error instanceof StructuredCompletionError) {
    const code: WalkthroughErrorCode =
      error.code === 'schema-failed' ? 'provider-request-failed' : error.code;
    return new WalkthroughCompletionError(code, error.message);
  }
  return new WalkthroughCompletionError(
    'provider-request-failed',
    error instanceof Error ? error.message : String(error),
  );
}

function processOutput(raw: string): string {
  let text = raw.trim();
  if (text.length === 0) {
    throw new WalkthroughCompletionError('empty-output', 'Walkthrough generation returned no text');
  }
  text = text.replace(/\0/g, '');
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  if (bytes.length <= MAX_OUTPUT_BYTES) return text;
  const suffixBytes = encoder.encode(OUTPUT_TRUNCATED_SUFFIX);
  const maxPrefixBytes = MAX_OUTPUT_BYTES - suffixBytes.length;
  let end = maxPrefixBytes;
  while (end > 0) {
    const byte = bytes[end];
    if (byte === undefined) break;
    if ((byte & 0xc0) !== 0x80) break;
    end--;
  }
  const prefix = new TextDecoder().decode(bytes.subarray(0, end));
  return `${prefix}${OUTPUT_TRUNCATED_SUFFIX}`;
}
