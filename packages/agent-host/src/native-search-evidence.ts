/**
 * Pure normalizers from provider-native search responses (JSON or SSE text)
 * into one product evidence shape. No I/O; callers hand over the raw body a
 * transport observed. Evidence is only ever taken from provider structures —
 * never guessed from model prose — so `eventDetected === false` always means
 * empty hits and citations.
 */
import type { NativeSearchAdapterKind, SearchHit, WebSearchCitation } from '@piwin/contracts';

/** Bound on the grounded brief handed back to the Host tool. */
export const NATIVE_SEARCH_ANSWER_MAX_CHARS = 12_000;

export type NativeSearchEvidence = {
  answer: string;
  searchQueries: string[];
  hits: SearchHit[];
  citations: WebSearchCitation[];
  /** Gemini `searchEntryPoint.renderedContent`, verbatim. */
  searchSuggestionsHtml?: string;
  eventDetected: boolean;
  /** Anthropic `stop_reason: pause_turn`: the server tool loop wants a continuation. */
  pauseTurn?: boolean;
  /** Anthropic raw assistant content blocks, needed to build a `pause_turn` continuation. */
  anthropicContent?: unknown[];
};

type JsonRecord = Record<string, unknown>;

/** Dispatch on the declared adapter. Unknown/vendor adapters yield no evidence. */
export function parseNativeSearchEvidence(
  adapter: NativeSearchAdapterKind,
  body: string,
): NativeSearchEvidence {
  switch (adapter) {
    case 'openai-responses-tool':
    case 'xai-web-search-tool':
      return parseResponsesEvidence(body);
    case 'openai-web-search-options':
      return parseChatCompletionsEvidence(body);
    case 'anthropic-web-search-tool':
      return parseAnthropicEvidence(body);
    case 'google-search-tool':
      return parseGeminiEvidence(body);
    default:
      return emptyEvidence('');
  }
}

// ── OpenAI / xAI Responses ───────────────────────────────────────────────────

export function parseResponsesEvidence(body: string): NativeSearchEvidence {
  const json = tryParseJson(body);
  if (isRecord(json)) return responsesFromObject(json);
  const events = parseSseData(body);
  for (const event of events) {
    if (event.type === 'response.completed' && isRecord(event.response)) {
      return responsesFromObject(event.response);
    }
  }
  // No terminal event (truncated stream): rebuild from item/delta events.
  const output: unknown[] = [];
  let text = '';
  for (const event of events) {
    if (event.type === 'response.output_item.done' && isRecord(event.item)) output.push(event.item);
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') text += event.delta;
  }
  const rebuilt = responsesFromObject({ output });
  return rebuilt.answer ? rebuilt : { ...rebuilt, answer: boundAnswer(text) };
}

function responsesFromObject(response: JsonRecord): NativeSearchEvidence {
  const queries: string[] = [];
  const sources: SearchHit[] = [];
  const citations: WebSearchCitation[] = [];
  let answer = '';
  let detected = false;
  for (const item of asArray(response.output)) {
    if (!isRecord(item)) continue;
    if (item.type === 'web_search_call') {
      detected = true;
      const action = isRecord(item.action) ? item.action : {};
      pushString(queries, action.query);
      for (const query of asArray(action.queries)) pushString(queries, query);
      for (const source of asArray(action.sources)) {
        if (isRecord(source)) pushHit(sources, source.url, source.title, undefined);
      }
    }
    if (item.type === 'message') {
      for (const part of asArray(item.content)) {
        if (!isRecord(part) || part.type !== 'output_text') continue;
        if (typeof part.text === 'string') answer += part.text;
        for (const annotation of asArray(part.annotations)) {
          if (isRecord(annotation) && annotation.type === 'url_citation') {
            detected = true;
            pushCitation(citations, annotation.url, annotation.title, undefined);
          }
        }
      }
    }
  }
  // xAI also reports a flat top-level `citations: string[]`.
  for (const url of asArray(response.citations)) {
    if (typeof url === 'string' && isHttpUrl(url)) {
      detected = true;
      pushCitation(citations, url, undefined, undefined);
    }
  }
  return finish({ answer, queries, sources, citations, detected });
}

// ── OpenAI Chat Completions (`web_search_options`) ──────────────────────────

export function parseChatCompletionsEvidence(body: string): NativeSearchEvidence {
  const json = tryParseJson(body);
  const chunks = isRecord(json) ? [json] : parseSseData(body);
  const citations: WebSearchCitation[] = [];
  let answer = '';
  for (const chunk of chunks) {
    for (const choice of asArray(chunk.choices)) {
      if (!isRecord(choice)) continue;
      const message = isRecord(choice.message) ? choice.message : isRecord(choice.delta) ? choice.delta : {};
      if (typeof message.content === 'string') answer += message.content;
      for (const annotation of asArray(message.annotations)) {
        if (!isRecord(annotation) || annotation.type !== 'url_citation') continue;
        const inner = isRecord(annotation.url_citation) ? annotation.url_citation : annotation;
        pushCitation(citations, inner.url, inner.title, undefined);
      }
    }
  }
  return finish({ answer, queries: [], sources: [], citations, detected: citations.length > 0 });
}

// ── Anthropic Messages ──────────────────────────────────────────────────────

export function parseAnthropicEvidence(body: string): NativeSearchEvidence {
  const json = tryParseJson(body);
  const message = isRecord(json) ? json : rebuildAnthropicMessage(parseSseData(body));
  const content = asArray(message.content);
  const queries: string[] = [];
  const sources: SearchHit[] = [];
  const citations: WebSearchCitation[] = [];
  let answer = '';
  let detected = false;
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === 'server_tool_use' && block.name === 'web_search') {
      detected = true;
      if (isRecord(block.input)) pushString(queries, block.input.query);
    }
    if (block.type === 'web_search_tool_result') {
      detected = true;
      // `encrypted_content` is opaque replay data, never a readable snippet.
      for (const result of asArray(block.content)) {
        if (isRecord(result) && result.type === 'web_search_result') {
          pushHit(sources, result.url, result.title, undefined);
        }
      }
    }
    if (block.type === 'text') {
      if (typeof block.text === 'string') answer += block.text;
      for (const citation of asArray(block.citations)) {
        if (isRecord(citation) && citation.type === 'web_search_result_location') {
          pushCitation(citations, citation.url, citation.title, citation.cited_text);
        }
      }
    }
  }
  const evidence = finish({ answer, queries, sources, citations, detected });
  return {
    ...evidence,
    ...(message.stop_reason === 'pause_turn' ? { pauseTurn: true } : {}),
    anthropicContent: content,
  };
}

/** Fold Anthropic SSE events back into one message (content blocks by index). */
function rebuildAnthropicMessage(events: JsonRecord[]): JsonRecord {
  const blocks: JsonRecord[] = [];
  const partialJson = new Map<number, string>();
  let stopReason: unknown;
  for (const event of events) {
    const index = typeof event.index === 'number' ? event.index : -1;
    if (event.type === 'message_start' && isRecord(event.message)) {
      for (const block of asArray(event.message.content)) if (isRecord(block)) blocks.push({ ...block });
    }
    if (event.type === 'content_block_start' && isRecord(event.content_block) && index >= 0) {
      blocks[index] = { ...event.content_block };
    }
    if (event.type === 'content_block_delta' && isRecord(event.delta) && index >= 0) {
      const block = blocks[index];
      if (!block) continue;
      const delta = event.delta;
      if (delta.type === 'text_delta' && typeof delta.text === 'string') {
        block.text = `${typeof block.text === 'string' ? block.text : ''}${delta.text}`;
      }
      if (delta.type === 'citations_delta' && isRecord(delta.citation)) {
        block.citations = [...asArray(block.citations), delta.citation];
      }
      if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        partialJson.set(index, `${partialJson.get(index) ?? ''}${delta.partial_json}`);
      }
    }
    if (event.type === 'content_block_stop' && index >= 0) {
      const json = partialJson.get(index);
      const block = blocks[index];
      if (json !== undefined && block) {
        const parsed = tryParseJson(json);
        if (parsed !== undefined) block.input = parsed;
      }
    }
    if (event.type === 'message_delta' && isRecord(event.delta) && event.delta.stop_reason !== undefined) {
      stopReason = event.delta.stop_reason;
    }
  }
  return { content: blocks.filter(isRecord), stop_reason: stopReason };
}

// ── Gemini generateContent ──────────────────────────────────────────────────

export function parseGeminiEvidence(body: string): NativeSearchEvidence {
  const json = tryParseJson(body);
  const chunks = Array.isArray(json) ? json.filter(isRecord) : isRecord(json) ? [json] : parseSseData(body);
  const queries: string[] = [];
  const sources: SearchHit[] = [];
  const citations: WebSearchCitation[] = [];
  let answer = '';
  let detected = false;
  let suggestions: string | undefined;
  for (const chunk of chunks) {
    const candidate = asArray(chunk.candidates).find(isRecord);
    if (!candidate) continue;
    if (isRecord(candidate.content)) {
      for (const part of asArray(candidate.content.parts)) {
        if (isRecord(part) && typeof part.text === 'string' && part.thought !== true) answer += part.text;
      }
    }
    const grounding = isRecord(candidate.groundingMetadata) ? candidate.groundingMetadata : undefined;
    if (!grounding) continue;
    for (const query of asArray(grounding.webSearchQueries)) pushString(queries, query);
    const chunkUrls: Array<{ url: unknown; title: unknown }> = [];
    for (const groundingChunk of asArray(grounding.groundingChunks)) {
      const web = isRecord(groundingChunk) && isRecord(groundingChunk.web) ? groundingChunk.web : {};
      chunkUrls.push({ url: web.uri, title: web.title });
      pushHit(sources, web.uri, web.title, undefined);
    }
    for (const support of asArray(grounding.groundingSupports)) {
      if (!isRecord(support)) continue;
      for (const chunkIndex of asArray(support.groundingChunkIndices)) {
        const ref = typeof chunkIndex === 'number' ? chunkUrls[chunkIndex] : undefined;
        if (ref) pushCitation(citations, ref.url, ref.title, undefined);
      }
    }
    const entry = isRecord(grounding.searchEntryPoint) ? grounding.searchEntryPoint : undefined;
    if (entry && typeof entry.renderedContent === 'string' && entry.renderedContent.length > 0) {
      suggestions = entry.renderedContent;
    }
    if (queries.length > 0 || chunkUrls.length > 0 || suggestions !== undefined) detected = true;
  }
  const evidence = finish({ answer, queries, sources, citations, detected });
  return detected && suggestions !== undefined ? { ...evidence, searchSuggestionsHtml: suggestions } : evidence;
}

// ── shared helpers ──────────────────────────────────────────────────────────

function finish(input: {
  answer: string;
  queries: string[];
  sources: SearchHit[];
  citations: WebSearchCitation[];
  detected: boolean;
}): NativeSearchEvidence {
  if (!input.detected) return emptyEvidence(input.answer);
  // Hits = listed sources first, then cited URLs the source list missed.
  const hits = [...input.sources];
  const byUrl = new Map(hits.map((hit) => [urlKey(hit.url), hit]));
  for (const citation of input.citations) {
    const existing = byUrl.get(urlKey(citation.url));
    if (existing) {
      if (!existing.snippet && citation.citedText) existing.snippet = citation.citedText;
      if (existing.title === hostLabel(existing.url) && citation.title) existing.title = citation.title;
      continue;
    }
    const hit: SearchHit = {
      title: citation.title ?? hostLabel(citation.url),
      url: citation.url,
      snippet: citation.citedText ?? '',
    };
    hits.push(hit);
    byUrl.set(urlKey(hit.url), hit);
  }
  return {
    answer: boundAnswer(input.answer),
    searchQueries: [...new Set(input.queries)],
    hits,
    citations: input.citations,
    eventDetected: true,
  };
}

function emptyEvidence(answer: string): NativeSearchEvidence {
  return { answer: boundAnswer(answer), searchQueries: [], hits: [], citations: [], eventDetected: false };
}

function pushHit(target: SearchHit[], url: unknown, title: unknown, snippet: string | undefined): void {
  if (typeof url !== 'string' || !isHttpUrl(url)) return;
  if (target.some((hit) => urlKey(hit.url) === urlKey(url))) return;
  target.push({ title: nonEmpty(title) ?? hostLabel(url), url, snippet: snippet ?? '' });
}

function pushCitation(target: WebSearchCitation[], url: unknown, title: unknown, citedText: unknown): void {
  if (typeof url !== 'string' || !isHttpUrl(url)) return;
  const cleanTitle = nonEmpty(title);
  const cleanText = nonEmpty(citedText);
  const existing = target.find((citation) => urlKey(citation.url) === urlKey(url));
  if (existing) {
    if (!existing.title && cleanTitle) existing.title = cleanTitle;
    if (!existing.citedText && cleanText) existing.citedText = cleanText;
    return;
  }
  target.push({ url, ...(cleanTitle ? { title: cleanTitle } : {}), ...(cleanText ? { citedText: cleanText } : {}) });
}

function pushString(target: string[], value: unknown): void {
  const text = nonEmpty(value);
  if (text) target.push(text);
}

function parseSseData(body: string): JsonRecord[] {
  const events: JsonRecord[] = [];
  for (const frame of body.split(/\r?\n\r?\n/u)) {
    const data = frame
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data || data === '[DONE]') continue;
    const parsed = tryParseJson(data);
    if (isRecord(parsed)) events.push(parsed);
    else if (Array.isArray(parsed)) events.push(...parsed.filter(isRecord));
  }
  return events;
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function urlKey(url: string): string {
  return url.trim().toLowerCase();
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function boundAnswer(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > NATIVE_SEARCH_ANSWER_MAX_CHARS
    ? `${trimmed.slice(0, NATIVE_SEARCH_ANSWER_MAX_CHARS)}…`
    : trimmed;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
