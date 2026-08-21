import { describe, expect, it, vi } from 'vitest';
import { buildWebDocumentExtractor } from './model-web-document-extractor.js';

describe('buildWebDocumentExtractor', () => {
  it('forwards bytes to the media extractor', async () => {
    const extract = vi.fn(async () => ({
      name: 'report.pdf',
      mimeType: 'application/pdf',
      contentKind: 'document' as const,
      text: 'Hello PDF',
      truncated: false,
      pageCount: 1,
    }));
    const extractor = buildWebDocumentExtractor({ extract });
    const result = await extractor.extract({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'application/pdf',
      url: 'https://example.com/docs/report.pdf',
      maxChars: 200_000,
    });
    expect(extract).toHaveBeenCalledOnce();
    expect(result.text).toBe('Hello PDF');
    expect(result.pageCount).toBe(1);
    expect(result.title).toBe('report.pdf');
  });
});
