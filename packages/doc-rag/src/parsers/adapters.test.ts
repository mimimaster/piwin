import { describe, expect, it, vi } from 'vitest';
import { createMineruAdapter, mapMineruContentList } from './mineru-adapter.js';
import { createUnstructuredAdapter, mapUnstructuredElements } from './unstructured-adapter.js';

const unstructuredFixture = [
  { type: 'Title', text: 'Office Doc', metadata: { page_number: 1 } },
  { type: 'NarrativeText', text: 'A paragraph from Unstructured.', metadata: { page_number: 1 } },
];

const mineruFixture = {
  content_list: [
    { type: 'title', text: 'PDF Title', page_idx: 0 },
    { type: 'text', text: 'Page body from MinerU.', page_idx: 0 },
  ],
};

describe('unstructured adapter', () => {
  it('maps fixture elements and stays disabled by default', async () => {
    const disabled = createUnstructuredAdapter(false);
    expect(disabled.supports({ relativePath: 'a.docx', extension: '.docx' })).toBe(false);
    const blocks = mapUnstructuredElements(unstructuredFixture);
    expect(blocks[0]).toMatchObject({ type: 'title', text: 'Office Doc', page: 1 });
    const enabled = createUnstructuredAdapter(true);
    expect(enabled.supports({ relativePath: 'a.docx', extension: '.docx' })).toBe(false);
    const parsed = await enabled.parse({
      relativePath: 'a.json',
      extension: '.docx',
      content: JSON.stringify(unstructuredFixture),
      documentId: 'd1',
    });
    expect(parsed.blocks).toHaveLength(2);
  });

  it('posts docx bytes to Unstructured /general/v0/general when a Base URL is set', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify(unstructuredFixture), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const parser = createUnstructuredAdapter({
      enabled: true,
      http: {
        baseUrl: 'http://127.0.0.1:8000',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    });
    expect(parser.supports({ relativePath: 'a.docx', extension: '.docx' })).toBe(true);
    const parsed = await parser.parse({
      relativePath: 'a.docx',
      extension: '.docx',
      content: 'not-json',
      documentId: 'd1',
      bytes: new Uint8Array([0x50, 0x4b]),
    });
    expect(parsed.blocks[0]?.text).toBe('Office Doc');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/general/v0/general',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('mineru adapter', () => {
  it('maps content_list and never silently parses raw pdf', async () => {
    const disabled = createMineruAdapter(false);
    expect(disabled.supports({ relativePath: 'a.pdf', extension: '.pdf' })).toBe(false);
    await expect(
      disabled.parse({
        relativePath: 'a.pdf',
        extension: '.pdf',
        content: '%PDF-1.4',
        documentId: 'd2',
      }),
    ).rejects.toThrow('MINERU_NOT_CONFIGURED');
    const blocks = mapMineruContentList(mineruFixture.content_list);
    expect(blocks[1]).toMatchObject({ text: 'Page body from MinerU.', page: 0 });
    const enabled = createMineruAdapter(true);
    expect(enabled.supports({ relativePath: 'a.pdf', extension: '.pdf' })).toBe(false);
    const parsed = await enabled.parse({
      relativePath: 'a.pdf',
      extension: '.pdf',
      content: JSON.stringify(mineruFixture),
      documentId: 'd2',
    });
    expect(parsed.blocks).toHaveLength(2);
  });

  it('posts PDF bytes to mineru-api /file_parse when a Base URL is set', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({ results: { a: mineruFixture } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const parser = createMineruAdapter({
      enabled: true,
      http: {
        baseUrl: 'http://127.0.0.1:8000',
        apiKey: 'tok',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    });
    expect(parser.supports({ relativePath: 'a.pdf', extension: '.pdf' })).toBe(true);
    const bytes = new TextEncoder().encode('%PDF-1.4 fake');
    const parsed = await parser.parse({
      relativePath: 'docs/a.pdf',
      extension: '.pdf',
      content: '%PDF-1.4 fake',
      documentId: 'd2',
      bytes,
    });
    expect(parsed.blocks).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/file_parse',
      expect.objectContaining({
        method: 'POST',
        headers: { authorization: 'Bearer tok' },
      }),
    );
  });
});
