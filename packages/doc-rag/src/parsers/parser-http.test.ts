import { describe, expect, it } from 'vitest';
import {
  extractMineruContentList,
  extractMineruMarkdown,
  extractUnstructuredElements,
  joinParserEndpoint,
} from './parser-http.js';

describe('joinParserEndpoint', () => {
  it('appends the default path to a service root', () => {
    expect(joinParserEndpoint('http://127.0.0.1:8000', '/file_parse')).toBe(
      'http://127.0.0.1:8000/file_parse',
    );
  });

  it('does not double the path when the URL already includes it', () => {
    expect(joinParserEndpoint('http://127.0.0.1:8000/file_parse/', '/file_parse')).toBe(
      'http://127.0.0.1:8000/file_parse',
    );
  });
});

describe('extract parser payloads', () => {
  it('reads MinerU content_list from nested results', () => {
    expect(
      extractMineruContentList({
        results: { demo: { content_list: [{ type: 'text', text: 'Hi' }] } },
      }),
    ).toEqual([{ type: 'text', text: 'Hi' }]);
    expect(
      extractMineruMarkdown({ results: { demo: { md_content: '# Title' } } }),
    ).toBe('# Title');
  });

  it('reads Unstructured arrays or { elements }', () => {
    expect(extractUnstructuredElements([{ type: 'Title', text: 'A' }])).toHaveLength(1);
    expect(extractUnstructuredElements({ elements: [{ type: 'Title', text: 'A' }] })).toHaveLength(
      1,
    );
  });
});
