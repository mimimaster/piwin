/**
 * Text-only vision delegation: describe media attachments with a vision model
 * (or path-inject fallback) so the primary model never receives ImageContent.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type {
  MediaAttachmentRef,
  ModelInputModality,
  ModelProviderConfig,
  ModelRef,
  PiwinConfig,
  PromptAttachment,
  PromptInput,
  VisionDelegationConfig,
} from '@piwin/contracts';
import { formatTextModelImageInjection } from '@piwin/contracts';
import { findEnabledProvider, resolveDefaultModelRef } from './provider-helpers.js';
import { buildProviderRequestHeaders } from './provider-model-discovery.js';

export const DEFAULT_VISION_DELEGATION_SYSTEM_PROMPT =
  'Describe this image in detail for a coding agent. Include text in the image verbatim.';

export const DEFAULT_VISION_DELEGATION_TIMEOUT_MS = 30_000;

export function shouldDelegateVision(params: {
  primaryModelInput: readonly ModelInputModality[] | undefined;
  hasMediaAttachments: boolean;
  config: VisionDelegationConfig | undefined;
}): boolean {
  if (!params.config?.enabled) return false;
  if (!params.config.model) return false;
  if (!params.hasMediaAttachments) return false;
  const supportsImage = params.primaryModelInput?.includes('image') ?? false;
  return !supportsImage;
}

export function primaryModelSupportsImage(
  primaryModelInput: readonly ModelInputModality[] | undefined,
): boolean {
  return primaryModelInput?.includes('image') ?? false;
}

export function resolvePrimaryModelInput(
  input: PromptInput,
  config: PiwinConfig,
): readonly ModelInputModality[] | undefined {
  const ref = resolvePrimaryModelRef(input, config);
  if (!ref) return undefined;
  const provider = findEnabledProvider(config, ref.providerId);
  const model = provider?.models.find((item) => item.id === ref.modelId);
  return model?.input;
}

export function resolvePrimaryModelRef(
  input: PromptInput,
  config: PiwinConfig,
): ModelRef | undefined {
  if (input.model) {
    const provider = findEnabledProvider(config, input.model.providerId);
    if (!provider || !provider.models.some((m) => m.id === input.model?.modelId)) {
      return undefined;
    }
    return input.model;
  }
  return resolveDefaultModelRef(config);
}

export function formatVisionDescriptionInjection(params: {
  absolutePath: string;
  mimeType: string;
  model: ModelRef;
  description: string;
}): string {
  return [
    '[attached image — vision description]',
    `path: ${params.absolutePath}`,
    `mime: ${params.mimeType}`,
    `model: ${params.model.providerId}/${params.model.modelId}`,
    '',
    params.description.trim(),
  ].join('\n');
}

export type VisionDelegateRequest = {
  imagePath: string;
  mimeType: string;
  provider: ModelProviderConfig;
  modelId: string;
  apiKey: string;
  systemPrompt?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

export async function delegateImageToVisionModel(request: VisionDelegateRequest): Promise<string> {
  const bytes = await readFile(request.imagePath);
  const base64 = Buffer.from(bytes).toString('base64');
  const systemPrompt = request.systemPrompt?.trim() || DEFAULT_VISION_DELEGATION_SYSTEM_PROMPT;
  const timeoutMs = request.timeoutMs ?? DEFAULT_VISION_DELEGATION_TIMEOUT_MS;
  const fetchImpl = request.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error('vision delegation unavailable: fetch is not supported');
  }

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
  const onOuterAbort = () => timeoutController.abort();
  request.signal?.addEventListener('abort', onOuterAbort, { once: true });
  try {
    const protocol = request.provider.protocol;
    switch (protocol) {
      case 'openai-compatible':
        return await describeOpenAiCompatible({
          provider: request.provider,
          modelId: request.modelId,
          apiKey: request.apiKey,
          systemPrompt,
          mimeType: request.mimeType,
          base64,
          signal: timeoutController.signal,
          fetchImpl,
        });
      case 'anthropic-compatible':
        return await describeAnthropicCompatible({
          provider: request.provider,
          modelId: request.modelId,
          apiKey: request.apiKey,
          systemPrompt,
          mimeType: request.mimeType,
          base64,
          signal: timeoutController.signal,
          fetchImpl,
        });
      case 'google-gemini':
        return await describeGoogleGemini({
          provider: request.provider,
          modelId: request.modelId,
          apiKey: request.apiKey,
          systemPrompt,
          mimeType: request.mimeType,
          base64,
          signal: timeoutController.signal,
          fetchImpl,
        });
      default: {
        const exhaustive: never = protocol;
        throw new Error(`vision delegation unsupported protocol: ${String(exhaustive)}`);
      }
    }
  } finally {
    clearTimeout(timeout);
    request.signal?.removeEventListener('abort', onOuterAbort);
  }
}

async function describeOpenAiCompatible(params: {
  provider: Extract<ModelProviderConfig, { protocol: 'openai-compatible' }>;
  modelId: string;
  apiKey: string;
  systemPrompt: string;
  mimeType: string;
  base64: string;
  signal: AbortSignal;
  fetchImpl: typeof fetch;
}): Promise<string> {
  const url = buildOpenAiCompatibleChatCompletionsUrl(params.provider.baseUrl);
  const headers = await buildProviderRequestHeaders(params.provider, async () => params.apiKey);
  headers.set('content-type', 'application/json');
  const response = await params.fetchImpl(url, {
    method: 'POST',
    headers,
    signal: params.signal,
    body: JSON.stringify({
      model: params.modelId,
      messages: [
        { role: 'system', content: params.systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this image.' },
            {
              type: 'image_url',
              image_url: { url: `data:${params.mimeType};base64,${params.base64}` },
            },
          ],
        },
      ],
      max_tokens: 1024,
      temperature: 0.2,
      stream: false,
    }),
  });
  if (!response.ok) {
    throw await createVisionDelegationHttpError(response);
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error('vision delegation returned empty description');
  }
  return text;
}

async function describeAnthropicCompatible(params: {
  provider: Extract<ModelProviderConfig, { protocol: 'anthropic-compatible' }>;
  modelId: string;
  apiKey: string;
  systemPrompt: string;
  mimeType: string;
  base64: string;
  signal: AbortSignal;
  fetchImpl: typeof fetch;
}): Promise<string> {
  const url = buildAnthropicMessagesUrl(params.provider.baseUrl);
  const headers = await buildProviderRequestHeaders(params.provider, async () => params.apiKey);
  headers.set('content-type', 'application/json');
  const response = await params.fetchImpl(url, {
    method: 'POST',
    headers,
    signal: params.signal,
    body: JSON.stringify({
      model: params.modelId,
      system: params.systemPrompt,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: params.mimeType,
                data: params.base64,
              },
            },
            { type: 'text', text: 'Describe this image.' },
          ],
        },
      ],
    }),
  });
  if (!response.ok) {
    throw await createVisionDelegationHttpError(response);
  }
  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = data.content?.find((block) => block.type === 'text')?.text?.trim();
  if (!text) {
    throw new Error('vision delegation returned empty description');
  }
  return text;
}

async function describeGoogleGemini(params: {
  provider: Extract<ModelProviderConfig, { protocol: 'google-gemini' }>;
  modelId: string;
  apiKey: string;
  systemPrompt: string;
  mimeType: string;
  base64: string;
  signal: AbortSignal;
  fetchImpl: typeof fetch;
}): Promise<string> {
  const base = params.provider.baseUrl.replace(/\/+$/, '');
  const url = `${base}/models/${encodeURIComponent(params.modelId)}:generateContent`;
  const headers = await buildProviderRequestHeaders(params.provider, async () => params.apiKey);
  headers.set('content-type', 'application/json');
  const response = await params.fetchImpl(url, {
    method: 'POST',
    headers,
    signal: params.signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: params.systemPrompt }] },
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'Describe this image.' },
            { inline_data: { mime_type: params.mimeType, data: params.base64 } },
          ],
        },
      ],
      generationConfig: { maxOutputTokens: 1024, temperature: 0.2 },
    }),
  });
  if (!response.ok) {
    throw await createVisionDelegationHttpError(response);
  }
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? '')
    .join('')
    .trim();
  if (!text) {
    throw new Error('vision delegation returned empty description');
  }
  return text;
}

function buildOpenAiCompatibleChatCompletionsUrl(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '');
  return normalizedBaseUrl.endsWith('/v1')
    ? `${normalizedBaseUrl}/chat/completions`
    : `${normalizedBaseUrl}/v1/chat/completions`;
}

function buildAnthropicMessagesUrl(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '');
  return normalizedBaseUrl.endsWith('/v1')
    ? `${normalizedBaseUrl}/messages`
    : `${normalizedBaseUrl}/v1/messages`;
}

async function createVisionDelegationHttpError(response: Response): Promise<Error> {
  const responseBody = await response.text();
  const providerMessage = extractProviderErrorMessage(responseBody);
  const statusText = response.statusText || 'request rejected';
  const detail = providerMessage ? `: ${providerMessage}` : '';
  return new Error(`vision delegation failed (${response.status} ${statusText})${detail}`);
}

function extractProviderErrorMessage(responseBody: string): string | undefined {
  const normalizedBody = responseBody.trim();
  if (!normalizedBody) {
    return undefined;
  }

  try {
    const parsedBody: unknown = JSON.parse(normalizedBody);
    const parsedMessage = readProviderMessage(parsedBody);
    if (parsedMessage) {
      return parsedMessage;
    }
  } catch {
    // Some gateways return plain text for errors. The compacted body below is
    // still useful and is bounded so a proxy cannot flood the settings toast.
  }

  return compactProviderErrorMessage(normalizedBody);
}

function readProviderMessage(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return compactProviderErrorMessage(value);
  }
  if (!isRecord(value)) {
    return undefined;
  }

  const directMessage = value.message;
  if (typeof directMessage === 'string' && directMessage.trim()) {
    return compactProviderErrorMessage(directMessage);
  }

  const errorValue = value.error;
  if (typeof errorValue === 'string') {
    return compactProviderErrorMessage(errorValue);
  }
  if (isRecord(errorValue)) {
    const nestedMessage = errorValue.message;
    if (typeof nestedMessage === 'string' && nestedMessage.trim()) {
      return compactProviderErrorMessage(nestedMessage);
    }
  }

  return undefined;
}

function compactProviderErrorMessage(message: string): string | undefined {
  const compactedMessage = message.replace(/\s+/g, ' ').trim();
  if (!compactedMessage) {
    return undefined;
  }
  return compactedMessage.slice(0, 500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** In-memory LRU for successful vision descriptions. */
export class VisionDelegationCache {
  private readonly maxEntries: number;
  private readonly map = new Map<string, string>();

  constructor(maxEntries = 64) {
    this.maxEntries = maxEntries;
  }

  get size(): number {
    return this.map.size;
  }

  static buildKey(params: {
    fileBytes: Uint8Array;
    mimeType: string;
    providerId: string;
    modelId: string;
    systemPrompt: string;
  }): string {
    const hash = createHash('sha256');
    hash.update(params.fileBytes);
    hash.update('|');
    hash.update(params.mimeType);
    hash.update('|');
    hash.update(params.providerId);
    hash.update('|');
    hash.update(params.modelId);
    hash.update('|');
    hash.update(params.systemPrompt);
    return hash.digest('hex');
  }

  get(key: string): string | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // refresh LRU order
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: string): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }
}

/** Process-wide cache shared by session prompt path and vision/* IPC. */
export const sharedVisionDelegationCache = new VisionDelegationCache();

export function pathInjectMediaAttachment(attachment: MediaAttachmentRef): string {
  return formatTextModelImageInjection({
    absolutePath: attachment.path,
    mimeType: attachment.mimeType,
    byteSize: attachment.byteSize,
    ...(attachment.width !== undefined ? { width: attachment.width } : {}),
    ...(attachment.height !== undefined ? { height: attachment.height } : {}),
  });
}

export function splitAttachments(attachments: PromptAttachment[] | undefined): {
  media: MediaAttachmentRef[];
  other: PromptAttachment[];
} {
  const media: MediaAttachmentRef[] = [];
  const other: PromptAttachment[] = [];
  for (const attachment of attachments ?? []) {
    if (attachment.kind === 'media') {
      media.push(attachment);
    } else {
      other.push(attachment);
    }
  }
  return { media, other };
}
