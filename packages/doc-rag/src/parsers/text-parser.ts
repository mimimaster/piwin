import type { ParsedBlock, ParsedDocument } from '@piwin/contracts';
import { TEXT_EXTENSIONS, CONFIG_EXTENSIONS, fileExtension } from './extensions.js';
import type { DocumentParser, ParserInput } from './types.js';

const EXTENSIONS = new Set<string>([...TEXT_EXTENSIONS, ...CONFIG_EXTENSIONS]);

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function createTextParser(): DocumentParser {
  return {
    id: 'text-v1',
    version: '1',
    supports(input) {
      return EXTENSIONS.has(input.extension || fileExtension(input.relativePath));
    },
    async parse(input: ParserInput): Promise<ParsedDocument> {
      const normalized = stripBom(input.content).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const paragraphs = normalized.split(/\n\s*\n/);
      const blocks: ParsedBlock[] = [];
      let line = 1;
      let order = 0;
      for (const paragraph of paragraphs) {
        const text = paragraph.trim();
        const lineCount = paragraph.length === 0 ? 1 : paragraph.split('\n').length;
        if (text.length > 0) {
          blocks.push({
            blockId: `b${order}`,
            order,
            type: 'paragraph',
            text,
            startLine: line,
            endLine: line + lineCount - 1,
          });
          order += 1;
        }
        line += lineCount + 1;
      }
      return {
        documentId: input.documentId,
        relativePath: input.relativePath,
        blocks,
        parser: { id: 'text-v1', version: '1' },
      };
    },
  };
}
