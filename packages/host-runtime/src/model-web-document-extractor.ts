/** Host composition for `web_fetch` PDF extract (Phase D). */

import type { WebDocumentExtractor } from '@piwin/contracts';
import { extractAttachmentTextFromBytes } from '@piwin/media';

export type BuildWebDocumentExtractorDependencies = {
  extract?: typeof extractAttachmentTextFromBytes;
};

export function buildWebDocumentExtractor(
  dependencies: BuildWebDocumentExtractorDependencies = {},
): WebDocumentExtractor {
  const extract = dependencies.extract ?? extractAttachmentTextFromBytes;
  return {
    async extract(input) {
      if (input.signal?.aborted) {
        throw new Error('web_fetch document extract aborted');
      }
      const extracted = await extract(input.bytes, input.mimeType, {
        maxBytes: Math.max(input.maxChars, 1),
        name: titleFromUrl(input.url),
      });
      return {
        text: extracted.text,
        title: extracted.name,
        ...(extracted.pageCount !== undefined ? { pageCount: extracted.pageCount } : {}),
      };
    },
  };
}

function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split('/').filter(Boolean).at(-1);
    return last && last.length > 0 ? decodeURIComponent(last) : parsed.hostname;
  } catch {
    return 'document';
  }
}
