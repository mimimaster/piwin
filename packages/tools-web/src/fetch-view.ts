import type { WebFetchExtraction, WebFetchResult } from '@piwin/contracts';
import type { ResolvedFetchCaps } from './fetch-caps.js';
import type { FetchStoreRecord } from './fetch-cache.js';

export type WebFetchViewInput = {
  query?: string;
  offset?: number;
  maxChars?: number;
  outline?: boolean;
};

export function selectFetchView(
  stored: FetchStoreRecord,
  view: WebFetchViewInput,
  caps: ResolvedFetchCaps,
  fromCache: boolean,
): WebFetchResult {
  const totalChars = stored.text.length;
  const base: WebFetchResult = {
    url: stored.url,
    finalUrl: stored.finalUrl,
    title: stored.title,
    text: '',
    contentType: stored.contentType,
    byteSize: stored.byteSize,
    truncated: stored.truncated,
    totalChars,
    fromCache,
    provider: stored.provider,
  };
  if (stored.truncationReason) {
    base.truncationReason = stored.truncationReason;
  }
  if (stored.outline.length > 0) {
    base.outline = stored.outline;
  }
  if (stored.thinContent === true) {
    base.thinContent = true;
  }
  if (stored.pageCount !== undefined) {
    base.pageCount = stored.pageCount;
  }

  if (stored.skipView === true) {
    return {
      ...base,
      text: stored.text,
      extraction: 'head',
      range: { start: 0, end: totalChars },
      hasMore: false,
    };
  }

  if (view.outline === true) {
    return {
      ...base,
      text: stored.outline.map((heading) => `- ${heading}`).join('\n'),
      extraction: 'outline',
      range: { start: 0, end: 0 },
      hasMore: totalChars > 0,
      nextOffset: 0,
    };
  }

  const offset = normalizeOffset(view.offset, totalChars);
  const windowSize = normalizeWindow(view.maxChars, caps.returnMaxChars);
  const end = Math.min(offset + windowSize, totalChars);
  const extraction: WebFetchExtraction = offset > 0 ? 'offset' : 'head';
  const result: WebFetchResult = {
    ...base,
    text: stored.text.slice(offset, end),
    extraction,
    range: { start: offset, end },
    hasMore: end < totalChars,
  };
  if (end < totalChars) {
    result.nextOffset = end;
  }
  return result;
}

function normalizeOffset(offset: number | undefined, totalChars: number): number {
  if (offset === undefined || !Number.isFinite(offset) || offset <= 0) {
    return 0;
  }
  return Math.min(Math.floor(offset), totalChars);
}

function normalizeWindow(maxChars: number | undefined, returnMaxChars: number): number {
  if (maxChars === undefined || !Number.isFinite(maxChars) || maxChars <= 0) {
    return returnMaxChars;
  }
  return Math.min(Math.floor(maxChars), returnMaxChars);
}
