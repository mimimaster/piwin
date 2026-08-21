import type { WebDocumentExtractor } from '@piwin/contracts';
import type { FetchStoreRecord } from './fetch-cache.js';
import type { FetchedDocument } from './fetch-transport.js';
import { validateFetchUrl } from './fetch-transport.js';
import type { ResolvedFetchCaps } from './fetch-caps.js';

export function looksLikePdf(contentType: string, bytes: Uint8Array): boolean {
  if (contentType.toLowerCase().includes('application/pdf')) {
    return true;
  }
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

export async function tryExtractPdfStore(input: {
  requestUrl: string;
  document: FetchedDocument;
  blockedPrefixes: string[];
  caps: ResolvedFetchCaps;
  extractor?: WebDocumentExtractor;
  signal?: AbortSignal;
}): Promise<FetchStoreRecord | undefined> {
  if (!looksLikePdf(input.document.contentType, input.document.rawBytes)) {
    return undefined;
  }
  if (!input.extractor) {
    throw new Error(`unsupported content-type for fetch: ${input.document.contentType}`);
  }
  const extracted = await input.extractor.extract({
    bytes: input.document.rawBytes,
    mimeType: 'application/pdf',
    url: input.document.finalUrl,
    maxChars: input.caps.storeMaxChars,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const truncated =
    input.document.bodyTruncated || extracted.text.length > input.caps.storeMaxChars;
  const text =
    extracted.text.length > input.caps.storeMaxChars
      ? extracted.text.slice(0, input.caps.storeMaxChars)
      : extracted.text;
  return {
    url: validateFetchUrl(input.requestUrl, input.blockedPrefixes),
    finalUrl: input.document.finalUrl,
    title: extracted.title,
    text,
    contentType: input.document.contentType,
    byteSize: input.document.byteSize,
    truncated,
    outline: [],
    provider: 'supermarkdown',
    ...(input.document.bodyTruncated
      ? { truncationReason: 'response-limit' as const }
      : truncated
        ? { truncationReason: 'text-limit' as const }
        : {}),
    ...(extracted.pageCount !== undefined ? { pageCount: extracted.pageCount } : {}),
  };
}
