import type { FetchStoreRecord } from './fetch-cache.js';
import { extractReadableText } from './readable-extract.js';
import { detectThinContent } from './fetch-thin.js';
import { validateFetchUrl } from './fetch-transport.js';

export async function storeFromRenderedHtml(input: {
  requestUrl: string;
  finalUrl: string;
  html: string;
  blockedPrefixes: string[];
  storeMaxChars: number;
  parseMaxChars: number;
  signal?: AbortSignal;
}): Promise<FetchStoreRecord> {
  const parseTruncated = input.html.length > input.parseMaxChars;
  const htmlToParse = parseTruncated ? input.html.slice(0, input.parseMaxChars) : input.html;
  const extracted = await extractReadableText(htmlToParse, input.finalUrl, input.signal);
  const storeSlice =
    extracted.text.length <= input.storeMaxChars
      ? { text: extracted.text, truncated: false }
      : { text: extracted.text.slice(0, input.storeMaxChars), truncated: true };
  const thinContent = detectThinContent(extracted.text, htmlToParse);
  return {
    url: validateFetchUrl(input.requestUrl, input.blockedPrefixes),
    finalUrl: input.finalUrl,
    title: extracted.title,
    text: storeSlice.text,
    contentType: 'text/html',
    byteSize: new TextEncoder().encode(input.html).byteLength,
    truncated: parseTruncated || storeSlice.truncated,
    outline: extracted.outline,
    provider: 'browser',
    ...(parseTruncated
      ? { truncationReason: 'parse-limit' as const }
      : storeSlice.truncated
        ? { truncationReason: 'text-limit' as const }
        : {}),
    ...(thinContent ? { thinContent: true } : {}),
  };
}
