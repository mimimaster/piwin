import { createHash } from 'node:crypto';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import type { DocChunkV2, ParsedBlock, ParsedDocument } from '@piwin/contracts';
import { splitLegacyCode } from './legacy-code-chunker.js';
import { normalizeParsedBlocks } from './normalize.js';
import { countTokens } from './tokens.js';

export const DEFAULT_CHUNKING = {
  targetMinTokens: 800,
  targetMaxTokens: 1200,
  hardMaxTokens: 1500,
  mergeBelowTokens: 200,
  overlapTokens: 120,
};

export type ChunkDocumentInput = {
  parsed: ParsedDocument;
  folderKey: string;
  language?: string;
};

function headingKey(path: string[] | undefined): string {
  return (path ?? []).join('\u0001');
}

function sourceAnchor(block: { startLine?: number; page?: number; order: number }): string {
  if (typeof block.startLine === 'number') return `L${block.startLine}`;
  if (typeof block.page === 'number') return `P${block.page}`;
  return `O${block.order}`;
}

function chunkId(documentId: string, content: string, anchor: string): string {
  const contentHash = createHash('sha256').update(content).digest('hex');
  return createHash('sha256')
    .update(`${documentId}\0${contentHash}\0${anchor}`)
    .digest('hex');
}

async function splitOversized(text: string, hardMax: number): Promise<string[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: Math.max(200, hardMax * 4),
    chunkOverlap: 80,
  });
  const parts = await splitter.splitText(text);
  const result: string[] = [];
  for (const part of parts) {
    if (countTokens(part) <= hardMax) {
      result.push(part);
      continue;
    }
    const words = part.split(/(\s+)/);
    let buffer = '';
    for (const word of words) {
      const next = buffer + word;
      if (buffer && countTokens(next) > hardMax) {
        result.push(buffer.trim());
        buffer = word;
      } else {
        buffer = next;
      }
    }
    if (buffer.trim()) result.push(buffer.trim());
  }
  return result.filter((part) => part.length > 0);
}

export async function chunkParsedDocument(input: ChunkDocumentInput): Promise<DocChunkV2[]> {
  const blocks = normalizeParsedBlocks(input.parsed.blocks);
  const isCode = input.parsed.parser.id === 'code-v1';
  const sections: Array<{ headingPath?: string[]; text: string; startLine?: number; endLine?: number; page?: number }> =
    [];

  if (isCode && blocks[0]) {
    for (const span of splitLegacyCode(blocks[0].text)) {
      sections.push({
        text: span.content,
        startLine: span.startLine,
        endLine: span.endLine,
      });
    }
  } else {
    const grouped = new Map<string, ParsedBlock[]>();
    const order: string[] = [];
    for (const block of blocks) {
      const key = headingKey(block.headingPath);
      if (!grouped.has(key)) {
        grouped.set(key, []);
        order.push(key);
      }
      grouped.get(key)?.push(block);
    }
    for (const key of order) {
      const group = grouped.get(key) ?? [];
      const first = group[0];
      const last = group[group.length - 1];
      const endLine = last?.endLine;
      sections.push({
        ...(first?.headingPath ? { headingPath: first.headingPath } : {}),
        text: group.map((block) => block.text).join('\n\n'),
        ...(typeof first?.startLine === 'number' ? { startLine: first.startLine } : {}),
        ...(typeof endLine === 'number' ? { endLine } : {}),
        ...(typeof first?.page === 'number' ? { page: first.page } : {}),
      });
    }
  }

  const merged: typeof sections = [];
  for (const section of sections) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      headingKey(previous.headingPath) === headingKey(section.headingPath) &&
      countTokens(previous.text) < DEFAULT_CHUNKING.mergeBelowTokens
    ) {
      previous.text = `${previous.text}\n\n${section.text}`;
      if (typeof section.endLine === 'number') previous.endLine = section.endLine;
      continue;
    }
    merged.push({ ...section });
  }

  const raw: Array<(typeof sections)[number] & { tokens: number }> = [];
  for (const section of merged) {
    if (countTokens(section.text) <= DEFAULT_CHUNKING.hardMaxTokens) {
      raw.push({ ...section, tokens: countTokens(section.text) });
      continue;
    }
    const parts = await splitOversized(section.text, DEFAULT_CHUNKING.hardMaxTokens);
    for (const part of parts) {
      raw.push({
        ...section,
        text: part,
        tokens: countTokens(part),
      });
    }
  }

  const chunks: DocChunkV2[] = raw.map((section, index) => {
    const contentHash = createHash('sha256').update(section.text).digest('hex');
    const id = chunkId(
      input.parsed.documentId,
      section.text,
      sourceAnchor({
        order: index,
        ...(typeof section.startLine === 'number' ? { startLine: section.startLine } : {}),
        ...(typeof section.page === 'number' ? { page: section.page } : {}),
      }),
    );
    return {
      chunkId: id,
      documentId: input.parsed.documentId,
      folderKey: input.folderKey,
      relativePath: input.parsed.relativePath,
      content: section.text,
      contentHash,
      ...(section.headingPath ? { headingPath: section.headingPath } : {}),
      sourceOrder: index,
      ...(typeof section.startLine === 'number' ? { startLine: section.startLine } : {}),
      ...(typeof section.endLine === 'number' ? { endLine: section.endLine } : {}),
      ...(typeof section.page === 'number' ? { pageStart: section.page, pageEnd: section.page } : {}),
      ...(input.language ? { language: input.language } : {}),
      tokenCount: section.tokens,
      parserId: input.parsed.parser.id,
      parserVersion: input.parsed.parser.version,
      chunkerId: isCode ? 'legacy-code-v1' : 'structure-recursive-v1',
      chunkerVersion: '1',
      ...(input.parsed.metadata ? { metadata: input.parsed.metadata } : {}),
    };
  });

  for (let index = 0; index < chunks.length; index += 1) {
    const current = chunks[index];
    if (!current) continue;
    const previousId = chunks[index - 1]?.chunkId;
    const nextId = chunks[index + 1]?.chunkId;
    if (previousId) current.previousChunkId = previousId;
    if (nextId) current.nextChunkId = nextId;
  }
  return chunks;
}
