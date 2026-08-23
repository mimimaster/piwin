/**
 * MinerU adapter. Maps structured content-list JSON, or POSTs the original
 * PDF to a configured mineru-api (`POST /file_parse`). No PDF binary fallback.
 */
import type { ParsedBlock, ParsedDocument } from '@piwin/contracts';
import { MINERU_EXTENSIONS, fileExtension } from './extensions.js';
import {
  DEFAULT_MINERU_PARSE_PATH,
  DEFAULT_MINERU_TIMEOUT_MS,
  extractMineruContentList,
  extractMineruMarkdown,
  joinParserEndpoint,
  parserFileName,
  parserInputBytes,
  parserMimeType,
  postParserFile,
  type ParserHttpClientOptions,
} from './parser-http.js';
import type { DocumentParser, ParserInput } from './types.js';

export type MineruContentItem = {
  type?: string;
  text?: string;
  page_idx?: number;
  page?: number;
};

export type MineruAdapterOptions = {
  enabled: boolean;
  http?: ParserHttpClientOptions;
};

export function mapMineruContentList(items: MineruContentItem[]): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  let order = 0;
  for (const item of items) {
    const text = item.text?.trim() ?? '';
    if (!text) continue;
    const page = item.page_idx ?? item.page;
    const type =
      item.type === 'title' ? 'title' : item.type === 'table' ? 'table' : 'paragraph';
    blocks.push({
      blockId: `b${order}`,
      order,
      type,
      text,
      ...(typeof page === 'number' ? { page } : {}),
    });
    order += 1;
  }
  return blocks;
}

export function createMineruAdapter(
  options: boolean | MineruAdapterOptions,
): DocumentParser {
  const enabled = typeof options === 'boolean' ? options : options.enabled;
  const http = typeof options === 'boolean' ? undefined : options.http;
  const endpoint = http?.baseUrl?.trim()
    ? joinParserEndpoint(http.baseUrl, DEFAULT_MINERU_PARSE_PATH)
    : '';

  return {
    id: 'mineru-v1',
    version: '1',
    supports(input) {
      if (!enabled || !endpoint) return false;
      return MINERU_EXTENSIONS.includes(
        (input.extension || fileExtension(input.relativePath)) as (typeof MINERU_EXTENSIONS)[number],
      );
    },
    async parse(input: ParserInput, signal?: AbortSignal): Promise<ParsedDocument> {
      if (!enabled) {
        throw new Error('MINERU_NOT_CONFIGURED');
      }
      const fromJson = tryMapMineruJson(input.content);
      if (fromJson) {
        return toParsedDocument(input, mapMineruContentList(fromJson));
      }
      if (!endpoint) {
        throw new Error('MINERU_NOT_CONFIGURED');
      }
      const payload = await postParserFile({
        endpoint,
        fieldName: 'files',
        fileName: parserFileName(input.relativePath),
        mimeType: parserMimeType(input.extension || fileExtension(input.relativePath)),
        bytes: parserInputBytes(input),
        extraFields: {
          return_content_list: 'true',
          return_md: 'true',
        },
        timeoutMs: http?.timeoutMs ?? DEFAULT_MINERU_TIMEOUT_MS,
        fetchImpl: http?.fetchImpl ?? fetch,
        ...(http?.apiKey ? { apiKey: http.apiKey } : {}),
        ...(signal ? { signal } : {}),
      });
      const items = extractMineruContentList(payload) as MineruContentItem[];
      const blocks = mapMineruContentList(items);
      if (blocks.length > 0) {
        return toParsedDocument(input, blocks);
      }
      const markdown = extractMineruMarkdown(payload)?.trim();
      if (markdown) {
        return toParsedDocument(input, [
          { blockId: 'b0', order: 0, type: 'paragraph', text: markdown },
        ]);
      }
      throw new Error('PARSER_FAILED');
    },
  };
}

function tryMapMineruJson(content: string): MineruContentItem[] | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    const items = extractMineruContentList(JSON.parse(trimmed) as unknown) as MineruContentItem[];
    return items.length > 0 ? items : null;
  } catch {
    return null;
  }
}

function toParsedDocument(input: ParserInput, blocks: ParsedBlock[]): ParsedDocument {
  return {
    documentId: input.documentId,
    relativePath: input.relativePath,
    blocks,
    parser: { id: 'mineru-v1', version: '1' },
  };
}
