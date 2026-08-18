import type { FlashcardItem, FlashcardModel } from '@piwin/contracts';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const FRONT_HEADING = '## Front';
const BACK_HEADING = '## Back';
const TEXT_HEADING = '## Text';
const SOURCE_HEADING = '## Source';

/**
 * Item markdown: frontmatter (id/deck/model/source metadata) + either
 * `## Front` / `## Back` (basic) or `## Text` (cloze).
 */
export function encodeCardMarkdown(card: FlashcardItem): string {
  const model: FlashcardModel = card.model === 'cloze' ? 'cloze' : 'basic';
  const lines: string[] = ['---'];
  lines.push(`id: ${JSON.stringify(card.id)}`);
  lines.push(`model: ${JSON.stringify(model)}`);
  lines.push(`deck: ${JSON.stringify(card.deck)}`);
  if (card.sourceNoteId) lines.push(`sourceNoteId: ${JSON.stringify(card.sourceNoteId)}`);
  if (card.sourceHash) lines.push(`sourceHash: ${JSON.stringify(card.sourceHash)}`);
  if (card.sourceFolder) lines.push(`sourceFolder: ${JSON.stringify(card.sourceFolder)}`);
  if (card.sourceFile) lines.push(`sourceFile: ${JSON.stringify(card.sourceFile)}`);
  if (typeof card.sourceLine === 'number') lines.push(`sourceLine: ${card.sourceLine}`);
  if (card.tags && card.tags.length > 0) lines.push(`tags: ${JSON.stringify(card.tags)}`);
  if (card.sequenceId) lines.push(`sequenceId: ${JSON.stringify(card.sequenceId)}`);
  if (typeof card.position === 'number') lines.push(`position: ${card.position}`);
  if (card.cardType) lines.push(`cardType: ${JSON.stringify(card.cardType)}`);
  if (card.relationFromPrevious) {
    lines.push(`relationFromPrevious: ${JSON.stringify(card.relationFromPrevious)}`);
  }
  if (card.knowledgePointIds && card.knowledgePointIds.length > 0) {
    lines.push(`knowledgePointIds: ${JSON.stringify(card.knowledgePointIds)}`);
  }
  if (card.sourceChunkIds && card.sourceChunkIds.length > 0) {
    lines.push(`sourceChunkIds: ${JSON.stringify(card.sourceChunkIds)}`);
  }
  if (card.generationId) lines.push(`generationId: ${JSON.stringify(card.generationId)}`);
  if (card.sourceDocumentIds && card.sourceDocumentIds.length > 0) {
    lines.push(`sourceDocumentIds: ${JSON.stringify(card.sourceDocumentIds)}`);
  }
  lines.push(`createdAt: ${JSON.stringify(card.createdAt)}`);
  lines.push('---');
  lines.push('');
  if (model === 'cloze') {
    lines.push(TEXT_HEADING);
    lines.push('');
    lines.push(card.text ?? '');
  } else {
    lines.push(FRONT_HEADING);
    lines.push('');
    lines.push(card.front ?? '');
    lines.push('');
    lines.push(BACK_HEADING);
    lines.push('');
    lines.push(card.back ?? '');
  }
  if (card.sourceExcerpt) {
    lines.push('');
    lines.push(SOURCE_HEADING);
    lines.push('');
    lines.push('> ' + card.sourceExcerpt.split('\n').join('\n> '));
  }
  lines.push('');
  return lines.join('\n');
}

export function decodeCardMarkdown(raw: string): FlashcardItem | null {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return null;
  const fields = parseFrontmatter(match[1] ?? '');
  const body = match[2] ?? '';

  const id = asString(fields.id);
  const deck = asString(fields.deck);
  const createdAt = asString(fields.createdAt);
  if (!id || !deck || !createdAt) return null;

  const sections = splitSections(body);
  const model: FlashcardModel =
    asString(fields.model) === 'cloze' || sections.text.trim()
      ? 'cloze'
      : 'basic';

  if (model === 'cloze') {
    const text = sections.text.trim();
    if (!text) return null;
    const card: FlashcardItem = { id, model: 'cloze', deck, text, createdAt };
    applyFrontmatter(card, fields, sections.source);
    return card;
  }

  const front = sections.front.trim();
  const back = sections.back.trim();
  if (!front || !back) return null;

  const card: FlashcardItem = { id, model: 'basic', deck, front, back, createdAt };
  applyFrontmatter(card, fields, sections.source);
  return card;
}

function applyFrontmatter(
  card: FlashcardItem,
  fields: Record<string, unknown>,
  source: string | undefined,
): void {
  const sourceNoteId = asString(fields.sourceNoteId);
  if (sourceNoteId) card.sourceNoteId = sourceNoteId;
  const sourceHash = asString(fields.sourceHash);
  if (sourceHash) card.sourceHash = sourceHash;
  const sourceFolder = asString(fields.sourceFolder);
  if (sourceFolder) card.sourceFolder = sourceFolder;
  const sourceFile = asString(fields.sourceFile);
  if (sourceFile) card.sourceFile = sourceFile;
  const sourceLine = asNumber(fields.sourceLine);
  if (sourceLine !== undefined) card.sourceLine = sourceLine;
  if (source) card.sourceExcerpt = source;
  const tags = asStringArray(fields.tags);
  if (tags) card.tags = tags;
  const sequenceId = asString(fields.sequenceId);
  if (sequenceId) card.sequenceId = sequenceId;
  const position = asNumber(fields.position);
  if (position !== undefined) card.position = position;
  const cardType = asString(fields.cardType);
  if (cardType) card.cardType = cardType;
  const relationFromPrevious = asString(fields.relationFromPrevious);
  if (relationFromPrevious) card.relationFromPrevious = relationFromPrevious;
  const knowledgePointIds = asStringArray(fields.knowledgePointIds);
  if (knowledgePointIds) card.knowledgePointIds = knowledgePointIds;
  const sourceChunkIds = asStringArray(fields.sourceChunkIds);
  if (sourceChunkIds) card.sourceChunkIds = sourceChunkIds;
  const generationId = asString(fields.generationId);
  if (generationId) card.generationId = generationId;
  const sourceDocumentIds = asStringArray(fields.sourceDocumentIds);
  if (sourceDocumentIds) card.sourceDocumentIds = sourceDocumentIds;
}

/**
 * Find a heading that sits alone on its own line — card content mentioning
 * "## Back" inline must not split the card.
 */
function findHeadingIndex(body: string, heading: string, fromIndex = 0): number {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const pattern = new RegExp(String.raw`^${escaped}\s*$`, 'm');
  const slice = body.slice(fromIndex);
  const found = pattern.exec(slice);
  return found ? fromIndex + found.index : -1;
}

function splitSections(body: string): {
  front: string;
  back: string;
  text: string;
  source?: string;
} {
  const textIndex = findHeadingIndex(body, TEXT_HEADING);
  if (textIndex !== -1) {
    const afterText = body.slice(textIndex + TEXT_HEADING.length);
    const sourceIndex = findHeadingIndex(afterText, SOURCE_HEADING);
    if (sourceIndex === -1) {
      return { front: '', back: '', text: afterText };
    }
    const text = afterText.slice(0, sourceIndex);
    const source = decodeSource(afterText.slice(sourceIndex + SOURCE_HEADING.length));
    return { front: '', back: '', text, ...(source ? { source } : {}) };
  }

  const frontIndex = findHeadingIndex(body, FRONT_HEADING);
  const backIndex =
    frontIndex === -1
      ? -1
      : findHeadingIndex(body, BACK_HEADING, frontIndex + FRONT_HEADING.length);
  if (frontIndex === -1 || backIndex === -1) {
    return { front: '', back: '', text: '' };
  }
  const front = body.slice(frontIndex + FRONT_HEADING.length, backIndex);
  const afterBack = body.slice(backIndex + BACK_HEADING.length);
  const sourceIndex = findHeadingIndex(afterBack, SOURCE_HEADING);
  if (sourceIndex === -1) {
    return { front, back: afterBack, text: '' };
  }
  const back = afterBack.slice(0, sourceIndex);
  const source = decodeSource(afterBack.slice(sourceIndex + SOURCE_HEADING.length));
  return { front, back, text: '', ...(source ? { source } : {}) };
}

function decodeSource(raw: string): string | undefined {
  const source = raw
    .trim()
    .split('\n')
    .map((line) => line.replace(/^>\s?/, ''))
    .join('\n')
    .trim();
  return source ? source : undefined;
}

function parseFrontmatter(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    const rawValue = trimmed.slice(colon + 1).trim();
    if (!key) continue;
    try {
      result[key] = JSON.parse(rawValue) as unknown;
    } catch {
      result[key] = rawValue;
    }
  }
  return result;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === 'string');
  return items.length > 0 ? items : undefined;
}
