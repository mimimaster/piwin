import { describe, expect, it } from 'vitest';
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
    const parsed = await enabled.parse({
      relativePath: 'a.json',
      extension: '.docx',
      content: JSON.stringify(unstructuredFixture),
      documentId: 'd1',
    });
    expect(parsed.blocks).toHaveLength(2);
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
    const parsed = await enabled.parse({
      relativePath: 'a.pdf',
      extension: '.pdf',
      content: JSON.stringify(mineruFixture),
      documentId: 'd2',
    });
    expect(parsed.blocks).toHaveLength(2);
  });
});
