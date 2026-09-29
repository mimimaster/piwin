import { describe, expect, it } from 'vitest';
import {
  parseAnthropicEvidence,
  parseChatCompletionsEvidence,
  parseGeminiEvidence,
  parseNativeSearchEvidence,
  parseResponsesEvidence,
} from './native-search-evidence.js';

const sse = (events: unknown[]): string =>
  `${events.map((event) => `event: x\ndata: ${JSON.stringify(event)}`).join('\n\n')}\n\ndata: [DONE]\n\n`;

describe('OpenAI / xAI Responses evidence', () => {
  const response = {
    output: [
      {
        type: 'web_search_call',
        action: {
          type: 'search',
          query: 'piwin release',
          sources: [
            { type: 'url', url: 'https://a.example/1', title: 'A one' },
            { type: 'url', url: 'javascript:alert(1)' },
          ],
        },
      },
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: 'Released [1].',
            annotations: [
              { type: 'url_citation', url: 'https://a.example/1', title: 'A one' },
              { type: 'url_citation', url: 'https://b.example/2', title: 'B two' },
            ],
          },
        ],
      },
    ],
  };

  it('parses a non-stream response', () => {
    const evidence = parseResponsesEvidence(JSON.stringify(response));
    expect(evidence.eventDetected).toBe(true);
    expect(evidence.searchQueries).toEqual(['piwin release']);
    expect(evidence.answer).toBe('Released [1].');
    expect(evidence.hits.map((hit) => hit.url)).toEqual(['https://a.example/1', 'https://b.example/2']);
    expect(evidence.hits[1]?.snippet).toBe('');
    expect(evidence.citations).toHaveLength(2);
  });

  it('prefers response.completed in SSE', () => {
    const body = sse([
      { type: 'response.output_text.delta', delta: 'Released' },
      { type: 'response.completed', response },
    ]);
    const evidence = parseNativeSearchEvidence('xai-web-search-tool', body);
    expect(evidence.hits).toHaveLength(2);
  });

  it('rebuilds from items when the stream is truncated', () => {
    const body = sse([
      { type: 'response.output_item.done', item: response.output[0] },
      { type: 'response.output_text.delta', delta: 'partial' },
    ]);
    const evidence = parseResponsesEvidence(body);
    expect(evidence.eventDetected).toBe(true);
    expect(evidence.answer).toBe('partial');
    expect(evidence.hits).toHaveLength(1);
  });

  it('reads xAI flat citations', () => {
    const evidence = parseResponsesEvidence(
      JSON.stringify({ output: [], citations: ['https://x.example/a', 'ftp://nope'] }),
    );
    expect(evidence.hits.map((hit) => hit.url)).toEqual(['https://x.example/a']);
  });

  it('never guesses URLs from prose when no search event exists', () => {
    const evidence = parseResponsesEvidence(
      JSON.stringify({
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'see https://guess.example' }] }],
      }),
    );
    expect(evidence.eventDetected).toBe(false);
    expect(evidence.hits).toEqual([]);
    expect(evidence.answer).toContain('guess');
  });
});

describe('OpenAI Chat Completions evidence', () => {
  it('reads nested url_citation annotations', () => {
    const body = JSON.stringify({
      choices: [
        {
          message: {
            content: 'Answer',
            annotations: [
              { type: 'url_citation', url_citation: { url: 'https://c.example', title: 'C', start_index: 0 } },
            ],
          },
        },
      ],
    });
    const evidence = parseChatCompletionsEvidence(body);
    expect(evidence.eventDetected).toBe(true);
    expect(evidence.hits).toEqual([{ title: 'C', url: 'https://c.example', snippet: '' }]);
  });

  it('tolerates missing fields', () => {
    expect(parseChatCompletionsEvidence('{}').eventDetected).toBe(false);
    expect(parseChatCompletionsEvidence('not json').hits).toEqual([]);
  });
});

describe('Anthropic evidence', () => {
  const content = [
    { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'claude news' } },
    {
      type: 'web_search_tool_result',
      tool_use_id: 'srvtoolu_1',
      content: [
        { type: 'web_search_result', url: 'https://d.example', title: 'D', encrypted_content: 'OPAQUE' },
      ],
    },
    {
      type: 'text',
      text: 'D says hi.',
      citations: [
        {
          type: 'web_search_result_location',
          url: 'https://d.example',
          title: 'D',
          cited_text: 'hi',
          encrypted_index: 'x',
        },
      ],
    },
  ];

  it('parses a non-stream message and keeps raw content', () => {
    const evidence = parseAnthropicEvidence(JSON.stringify({ content, stop_reason: 'end_turn' }));
    expect(evidence.searchQueries).toEqual(['claude news']);
    expect(evidence.hits).toEqual([{ title: 'D', url: 'https://d.example', snippet: 'hi' }]);
    expect(JSON.stringify(evidence.hits)).not.toContain('OPAQUE');
    expect(evidence.anthropicContent).toHaveLength(3);
    expect(evidence.pauseTurn).toBeUndefined();
  });

  it('rebuilds SSE blocks and flags pause_turn', () => {
    const body = sse([
      { type: 'message_start', message: { content: [] } },
      { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 's', name: 'web_search', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"q2"}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: content[1] },
      { type: 'content_block_stop', index: 1 },
      { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Part' } },
      { type: 'content_block_delta', index: 2, delta: { type: 'citations_delta', citation: content[2]?.citations?.[0] } },
      { type: 'content_block_stop', index: 2 },
      { type: 'message_delta', delta: { stop_reason: 'pause_turn' } },
    ]);
    const evidence = parseAnthropicEvidence(body);
    expect(evidence.searchQueries).toEqual(['q2']);
    expect(evidence.answer).toBe('Part');
    expect(evidence.pauseTurn).toBe(true);
    expect(evidence.hits).toHaveLength(1);
  });
});

describe('Gemini evidence', () => {
  const response = {
    candidates: [
      {
        content: { parts: [{ text: 'thinking', thought: true }, { text: 'Grounded.' }] },
        groundingMetadata: {
          webSearchQueries: ['gemini q'],
          groundingChunks: [
            { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', title: 'e.example' } },
          ],
          groundingSupports: [{ segment: { text: 'Grounded.' }, groundingChunkIndices: [0] }],
          searchEntryPoint: { renderedContent: '<div class="container">chips</div>' },
        },
      },
    ],
  };

  it('keeps queries, chunk hits, supports and suggestions verbatim', () => {
    const evidence = parseGeminiEvidence(JSON.stringify(response));
    expect(evidence.answer).toBe('Grounded.');
    expect(evidence.searchQueries).toEqual(['gemini q']);
    expect(evidence.hits[0]?.title).toBe('e.example');
    expect(evidence.citations).toHaveLength(1);
    expect(evidence.searchSuggestionsHtml).toBe('<div class="container">chips</div>');
  });

  it('returns no evidence without grounding', () => {
    const evidence = parseGeminiEvidence(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'x' }] } }] }));
    expect(evidence.eventDetected).toBe(false);
    expect(evidence.searchSuggestionsHtml).toBeUndefined();
  });
});

it('unknown adapters yield no evidence', () => {
  expect(parseNativeSearchEvidence('not-an-adapter' as never, '{"output":[]}').eventDetected).toBe(false);
});
