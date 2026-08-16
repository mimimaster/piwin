import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { ParsedBlock, ParsedBlockType, ParsedDocument } from '@piwin/contracts';
import { MARKDOWN_EXTENSIONS, fileExtension } from './extensions.js';
import type { DocumentParser, ParserInput } from './types.js';

type MdastNode = {
  type: string;
  value?: string;
  depth?: number;
  lang?: string;
  children?: MdastNode[];
  position?: { start?: { line?: number }; end?: { line?: number } };
};

const EXTENSIONS = new Set<string>(MARKDOWN_EXTENSIONS);

function nodeText(node: MdastNode): string {
  if (typeof node.value === 'string') return node.value;
  return (node.children ?? []).map((child) => nodeText(child)).join('');
}

function blockType(node: MdastNode): ParsedBlockType | undefined {
  switch (node.type) {
    case 'heading':
      return node.depth === 1 ? 'title' : 'heading';
    case 'paragraph':
      return 'paragraph';
    case 'code':
      return 'code';
    case 'list':
      return 'list';
    case 'blockquote':
      return 'quote';
    case 'table':
      return 'table';
    default:
      return undefined;
  }
}

export function createMarkdownParser(): DocumentParser {
  return {
    id: 'markdown-v1',
    version: '1',
    supports(input) {
      return EXTENSIONS.has(input.extension || fileExtension(input.relativePath));
    },
    async parse(input: ParserInput): Promise<ParsedDocument> {
      const tree = unified().use(remarkParse).parse(input.content) as MdastNode;
      const blocks: ParsedBlock[] = [];
      const headingPath: string[] = [];
      let order = 0;

      const visit = (node: MdastNode): void => {
        if (node.type === 'heading') {
          const depth = node.depth ?? 1;
          headingPath.length = depth - 1;
          headingPath.push(nodeText(node).trim());
        }
        const type = blockType(node);
        if (type && node.type !== 'root') {
          const text =
            node.type === 'code'
              ? node.value ?? ''
              : nodeText(node).trim();
          if (text.length > 0) {
            const path = headingPath.length > 0 ? [...headingPath] : undefined;
            blocks.push({
              blockId: `b${order}`,
              order,
              type,
              text,
              ...(path ? { headingPath: path } : {}),
              ...(typeof node.position?.start?.line === 'number'
                ? { startLine: node.position.start.line }
                : {}),
              ...(typeof node.position?.end?.line === 'number'
                ? { endLine: node.position.end.line }
                : {}),
            });
            order += 1;
          }
        }
        if (node.type === 'root') {
          for (const child of node.children ?? []) visit(child);
        }
      };

      visit(tree);
      const title = blocks.find((block) => block.type === 'title' || block.type === 'heading')?.text;
      return {
        documentId: input.documentId,
        relativePath: input.relativePath,
        ...(title ? { title } : {}),
        blocks,
        parser: { id: 'markdown-v1', version: '1' },
      };
    },
  };
}
