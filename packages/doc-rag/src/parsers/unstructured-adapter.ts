/**
 * Unstructured HTTP adapter. Maps structured JSON elements to ParsedBlock.
 * Does not parse DOC binaries. Disabled unless configured.
 */
import type { ParsedBlock, ParsedBlockType, ParsedDocument } from '@piwin/contracts';
import { UNSTRUCTURED_EXTENSIONS, fileExtension } from './extensions.js';
import type { DocumentParser, ParserInput } from './types.js';

export type UnstructuredElement = {
  type?: string;
  text?: string;
  metadata?: {
    page_number?: number;
    filename?: string;
  };
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

export function createUnstructuredAdapter(enabled: boolean): DocumentParser {
  return {
    id: 'unstructured-v1',
    version: '1',
    supports(input) {
      if (!enabled) return false;
      return UNSTRUCTURED_EXTENSIONS.includes(
        (input.extension || fileExtension(input.relativePath)) as (typeof UNSTRUCTURED_EXTENSIONS)[number],
      );
    },
    async parse(input: ParserInput): Promise<ParsedDocument> {
      if (!enabled) {
        throw new Error('UNSTRUCTURED_NOT_CONFIGURED');
      }
      let elements: UnstructuredElement[];
      try {
        const parsed: unknown = JSON.parse(input.content);
        elements = Array.isArray(parsed) ? (parsed as UnstructuredElement[]) : [];
      } catch {
        throw new Error('PARSER_FAILED');
      }
      return {
        documentId: input.documentId,
        relativePath: input.relativePath,
        blocks: mapUnstructuredElements(elements),
        parser: { id: 'unstructured-v1', version: '1' },
      };
    },
  };
}
