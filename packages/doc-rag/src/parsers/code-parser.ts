import type { ParsedDocument } from '@piwin/contracts';
import { CODE_EXTENSIONS, fileExtension } from './extensions.js';
import type { DocumentParser, ParserInput } from './types.js';

const EXTENSIONS = new Set<string>(CODE_EXTENSIONS);

export function createCodeParser(): DocumentParser {
  return {
    id: 'code-v1',
    version: '1',
    supports(input) {
      return EXTENSIONS.has(input.extension || fileExtension(input.relativePath));
    },
    async parse(input: ParserInput): Promise<ParsedDocument> {
      const text = input.content.replace(/\r\n/g, '\n');
      const lineCount = text.length === 0 ? 1 : text.split('\n').length;
      return {
        documentId: input.documentId,
        relativePath: input.relativePath,
        blocks:
          text.trim().length === 0
            ? []
            : [
                {
                  blockId: 'b0',
                  order: 0,
                  type: 'code',
                  text,
                  startLine: 1,
                  endLine: lineCount,
                },
              ],
        parser: { id: 'code-v1', version: '1' },
      };
    },
  };
}
