/**
 * Shared HTTP helpers for MinerU / Unstructured document parsers.
 * Adapters never embed secrets; Host injects the resolved API key.
 */

export type ParserHttpClientOptions = {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export const DEFAULT_MINERU_PARSE_PATH = '/file_parse';
export const DEFAULT_UNSTRUCTURED_PARSE_PATH = '/general/v0/general';
export const DEFAULT_MINERU_TIMEOUT_MS = 180_000;
export const DEFAULT_UNSTRUCTURED_TIMEOUT_MS = 60_000;

export function joinParserEndpoint(baseUrl: string, defaultPath: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  const path = defaultPath.startsWith('/') ? defaultPath : `/${defaultPath}`;
  if (!base) return path;
  if (base.endsWith(path)) return base;
  return `${base}${path}`;
}

export function parserFileName(relativePath: string): string {
  const base = relativePath.split(/[\\/]/).pop();
  return base && base.length > 0 ? base : 'document';
}

export function parserMimeType(extension: string): string {
  switch (extension) {
    case '.pdf':
      return 'application/pdf';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.doc':
      return 'application/msword';
    case '.html':
    case '.htm':
      return 'text/html';
    default:
      return 'application/octet-stream';
  }
}

export function parserInputBytes(input: { content: string; bytes?: Uint8Array }): Uint8Array {
  if (input.bytes && input.bytes.byteLength > 0) return input.bytes;
  return new TextEncoder().encode(input.content);
}

export async function postParserFile(input: {
  endpoint: string;
  fieldName: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  extraFields?: Record<string, string>;
  apiKey?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  fetchImpl: typeof fetch;
}): Promise<unknown> {
  const form = new FormData();
  const copy = new Uint8Array(input.bytes.byteLength);
  copy.set(input.bytes);
  form.append(input.fieldName, new Blob([copy], { type: input.mimeType }), input.fileName);
  for (const [key, value] of Object.entries(input.extraFields ?? {})) {
    form.append(key, value);
  }
  const headers: Record<string, string> = {};
  if (input.apiKey?.trim()) {
    headers.authorization = `Bearer ${input.apiKey.trim()}`;
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  input.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.fetchImpl(input.endpoint, {
      method: 'POST',
      headers,
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await safeErrorText(response);
      throw new Error(`PARSER_FAILED: HTTP ${response.status}${detail ? ` ${detail}` : ''}`);
    }
    const payload: unknown = await response.json();
    return payload;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('PARSER_FAILED: parser request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', onAbort);
  }
}

export function extractMineruContentList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.content_list)) return record.content_list;
  const results = record.results;
  if (results && typeof results === 'object') {
    for (const value of Object.values(results as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const item = value as Record<string, unknown>;
      if (Array.isArray(item.content_list)) return item.content_list;
    }
  }
  return [];
}

export function extractMineruMarkdown(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  if (typeof record.md_content === 'string' && record.md_content.trim()) {
    return record.md_content;
  }
  const results = record.results;
  if (results && typeof results === 'object') {
    for (const value of Object.values(results as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const item = value as Record<string, unknown>;
      if (typeof item.md_content === 'string' && item.md_content.trim()) {
        return item.md_content;
      }
    }
  }
  return undefined;
}

export function extractUnstructuredElements(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.elements)) return record.elements;
  return [];
}

async function safeErrorText(response: Response): Promise<string> {
  try {
    const text = (await response.text()).trim();
    return text.slice(0, 160);
  } catch {
    return '';
  }
}
