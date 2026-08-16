/**
 * MinerU adapter. Consumes structured content-list JSON only.
 * No PDF binary fallback.
 */
import type { ParsedBlock, ParsedDocument } from '@piwin/contracts';
import { MINERU_EXTENSIONS, fileExtension } from './extensions.js';
import type { DocumentParser, ParserInput } from './types.js';

export type MineruContentItem = {
  type?: string;
  text?: string;
  page_idx?: number;
  page?: number;
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

export function createMineruAdapter(enabled: boolean): DocumentParser {
  return {
    id: 'mineru-v1',
    version: '1',
    supports(input) {
      if (!enabled) return false;
      return MINERU_EXTENSIONS.includes(
        (input.extension || fileExtension(input.relativePath)) as (typeof MINERU_EXTENSIONS)[number],
      );
    },
    async parse(input: ParserInput): Promise<ParsedDocument> {
      if (!enabled) {
        throw new Error('MINERU_NOT_CONFIGURED');
      }
      let items: MineruContentItem[];
      try {
        const parsed: unknown = JSON.parse(input.content);
        if (Array.isArray(parsed)) {
          items = parsed as MineruContentItem[];
        } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { content_list?: unknown }).content_list)) {
          items = (parsed as { content_list: MineruContentItem[] }).content_list;
        } else {
          throw new Error('PARSER_FAILED');
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'PARSER_FAILED') throw error;
        throw new Error('PARSER_FAILED');
      }
      return {
        documentId: input.documentId,
        relativePath: input.relativePath,
        blocks: mapMineruContentList(items),
        parser: { id: 'mineru-v1', version: '1' },
      };
    },
  };
}
