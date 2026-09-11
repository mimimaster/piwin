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
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

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
      const stripped = stripLeadingFrontmatter(input.content);
      const tree = unified().use(remarkParse).parse(stripped.body) as MdastNode;
      const blocks: ParsedBlock[] = [];
      const headingPath: string[] = [];
      let order = 0;
      const lineOffset = stripped.frontmatterLineCount;

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
                ? { startLine: node.position.start.line + lineOffset }
                : {}),
              ...(typeof node.position?.end?.line === 'number'
                ? { endLine: node.position.end.line + lineOffset }
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
      const headingTitle = blocks.find(
        (block) => block.type === 'title' || block.type === 'heading',
      )?.text;
      const metadataTitle = stripped.metadata?.title;
      const title =
        typeof metadataTitle === 'string' && metadataTitle.trim().length > 0
          ? metadataTitle
          : headingTitle;
      return {
        documentId: input.documentId,
        relativePath: input.relativePath,
        ...(title ? { title } : {}),
        blocks,
        parser: { id: 'markdown-v1', version: '1' },
        ...(stripped.metadata ? { metadata: stripped.metadata } : {}),
      };
    },
  };
}

function stripLeadingFrontmatter(content: string): {
  body: string;
  metadata?: Record<string, unknown>;
  frontmatterLineCount: number;
} {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) {
    return { body: content, frontmatterLineCount: 0 };
  }
  let end = match[0].length;
  const rest = content.slice(end);
  if (rest.startsWith('\r\n')) end += 2;
  else if (rest.startsWith('\n')) end += 1;
  const prefix = content.slice(0, end);
  const metadata = parseFrontmatterBlock(match[1] ?? '');
  return {
    body: content.slice(end),
    frontmatterLineCount: (prefix.match(/\r?\n/g) ?? []).length,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}

function parseFrontmatterBlock(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    if (!key) continue;
    const rawValue = trimmed.slice(colon + 1).trim();
    result[key] = parseFrontmatterValue(rawValue);
  }
  return result;
}

function parseFrontmatterValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}
