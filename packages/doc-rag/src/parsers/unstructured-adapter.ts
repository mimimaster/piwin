/**
 * Unstructured HTTP adapter. Maps structured JSON elements, or POSTs the
 * original file to a configured Unstructured API (`POST /general/v0/general`).
 * Does not parse DOC binaries locally.
 */
import type { ParsedBlock, ParsedBlockType, ParsedDocument } from '@piwin/contracts';
import { UNSTRUCTURED_EXTENSIONS, fileExtension } from './extensions.js';
import {
  DEFAULT_UNSTRUCTURED_PARSE_PATH,
  DEFAULT_UNSTRUCTURED_TIMEOUT_MS,
  extractUnstructuredElements,
  joinParserEndpoint,
  parserFileName,
  parserInputBytes,
  parserMimeType,
  postParserFile,
  type ParserHttpClientOptions,
} from './parser-http.js';
import type { DocumentParser, ParserInput } from './types.js';

export type UnstructuredElement = {
  type?: string;
  text?: string;
  metadata?: {
    page_number?: number;
    filename?: string;
  };
};

export type UnstructuredAdapterOptions = {
  enabled: boolean;
  http?: ParserHttpClientOptions;
};

const TYPE_MAP: Record<string, ParsedBlockType> = {
  Title: 'title',
  Header: 'heading',
  NarrativeText: 'paragraph',
  UncategorizedText: 'paragraph',
  ListItem: 'list',
  Table: 'table',
  CodeSnippet: 'code',
};

export function mapUnstructuredElements(elements: UnstructuredElement[]): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  let order = 0;
  for (const element of elements) {
    const text = element.text?.trim() ?? '';
    if (!text) continue;
    const type = TYPE_MAP[element.type ?? ''] ?? 'paragraph';
    blocks.push({
      blockId: `b${order}`,
      order,
      type,
      text,
      ...(typeof element.metadata?.page_number === 'number'
        ? { page: element.metadata.page_number }
        : {}),
    });
    order += 1;
  }
  return blocks;
}

export function createUnstructuredAdapter(
  options: boolean | UnstructuredAdapterOptions,
): DocumentParser {
  const enabled = typeof options === 'boolean' ? options : options.enabled;
  const http = typeof options === 'boolean' ? undefined : options.http;
  const endpoint = http?.baseUrl?.trim()
    ? joinParserEndpoint(http.baseUrl, DEFAULT_UNSTRUCTURED_PARSE_PATH)
    : '';

  return {
    id: 'unstructured-v1',
    version: '1',
    supports(input) {
      if (!enabled || !endpoint) return false;
      return UNSTRUCTURED_EXTENSIONS.includes(
        (input.extension || fileExtension(input.relativePath)) as (typeof UNSTRUCTURED_EXTENSIONS)[number],
      );
    },
    async parse(input: ParserInput, signal?: AbortSignal): Promise<ParsedDocument> {
      if (!enabled) {
        throw new Error('UNSTRUCTURED_NOT_CONFIGURED');
      }
      const fromJson = tryMapUnstructuredJson(input.content);
      if (fromJson) {
        return toParsedDocument(input, mapUnstructuredElements(fromJson));
      }
      if (!endpoint) {
        throw new Error('UNSTRUCTURED_NOT_CONFIGURED');
      }
      const payload = await postParserFile({
        endpoint,
        fieldName: 'files',
        fileName: parserFileName(input.relativePath),
        mimeType: parserMimeType(input.extension || fileExtension(input.relativePath)),
        bytes: parserInputBytes(input),
        extraFields: { strategy: 'auto' },
        timeoutMs: http?.timeoutMs ?? DEFAULT_UNSTRUCTURED_TIMEOUT_MS,
        fetchImpl: http?.fetchImpl ?? fetch,
        ...(http?.apiKey ? { apiKey: http.apiKey } : {}),
        ...(signal ? { signal } : {}),
      });
      const blocks = mapUnstructuredElements(
        extractUnstructuredElements(payload) as UnstructuredElement[],
      );
      if (blocks.length === 0) {
        throw new Error('PARSER_FAILED');
      }
      return toParsedDocument(input, blocks);
    },
  };
}

function tryMapUnstructuredJson(content: string): UnstructuredElement[] | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    const elements = extractUnstructuredElements(JSON.parse(trimmed) as unknown) as UnstructuredElement[];
    return elements.length > 0 ? elements : null;
  } catch {
    return null;
  }
}

function toParsedDocument(input: ParserInput, blocks: ParsedBlock[]): ParsedDocument {
  return {
    documentId: input.documentId,
    relativePath: input.relativePath,
    blocks,
    parser: { id: 'unstructured-v1', version: '1' },
  };
}
