import { describe, expect, it } from 'vitest';
import { looksLikePdf, tryExtractPdfStore } from './fetch-document.js';
import type { ResolvedFetchCaps } from './fetch-caps.js';

const caps: ResolvedFetchCaps = {
  storeMaxChars: 100,
  returnMaxChars: 40,
  bodyMaxBytes: 400,
  parseMaxChars: 200,
  cacheTtlMs: 900_000,
};

describe('looksLikePdf', () => {
  it('detects the content-type and the %PDF magic', () => {
    expect(looksLikePdf('application/pdf', new Uint8Array())).toBe(true);
    expect(looksLikePdf('text/plain', new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(true);
    expect(looksLikePdf('text/html', new Uint8Array([0x3c, 0x68, 0x74, 0x6d]))).toBe(false);
  });
});

describe('tryExtractPdfStore', () => {
  it('returns undefined for ordinary HTML', async () => {
    const html = new TextEncoder().encode('<html><body>hi</body></html>');
    const store = await tryExtractPdfStore({
      requestUrl: 'https://example.com/doc',
      document: {
        finalUrl: 'https://example.com/doc',
        contentType: 'text/html',
        byteSize: html.byteLength,
        rawText: '<html><body>hi</body></html>',
        rawBytes: html,
        bodyTruncated: false,
      },
      blockedPrefixes: [],
      caps,
    });
    expect(store).toBeUndefined();
  });

  it('extracts PDF text through the injected port', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4 fake');
    const store = await tryExtractPdfStore({
      requestUrl: 'https://example.com/report.pdf',
      document: {
        finalUrl: 'https://example.com/report.pdf',
        contentType: 'application/pdf',
        byteSize: bytes.byteLength,
        rawText: '%PDF-1.4 fake',
        rawBytes: bytes,
        bodyTruncated: false,
      },
      blockedPrefixes: [],
      caps,
      extractor: {
        extract: async () => ({
          text: 'Hello from the PDF body.',
          title: 'report.pdf',
          pageCount: 2,
        }),
      },
    });
    expect(store?.text).toBe('Hello from the PDF body.');
    expect(store?.pageCount).toBe(2);
    expect(store?.title).toBe('report.pdf');
    expect(store?.provider).toBe('supermarkdown');
  });

  it('throws the legacy unsupported error when no extractor is injected', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4 fake');
    await expect(
      tryExtractPdfStore({
        requestUrl: 'https://example.com/report.pdf',
        document: {
          finalUrl: 'https://example.com/report.pdf',
          contentType: 'application/pdf',
          byteSize: bytes.byteLength,
          rawText: '%PDF-1.4 fake',
          rawBytes: bytes,
          bodyTruncated: false,
        },
        blockedPrefixes: [],
        caps,
      }),
    ).rejects.toThrow(/unsupported content-type/);
  });
});
