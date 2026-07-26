import type { FlashcardRecord } from '@piwin/contracts';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const FRONT_HEADING = '## Front';
const BACK_HEADING = '## Back';

/**
 * Card markdown: frontmatter (id/deck/source metadata) + `## Front` /
 * `## Back` sections. Human-readable, greppable, git-mergeable.
 */
export function encodeCardMarkdown(card: FlashcardRecord): string {
  const lines: string[] = ['---'];
  lines.push(`id: ${JSON.stringify(card.id)}`);
  lines.push(`deck: ${JSON.stringify(card.deck)}`);
  if (card.sourceNoteId) lines.push(`sourceNoteId: ${JSON.stringify(card.sourceNoteId)}`);
  if (card.sourceHash) lines.push(`sourceHash: ${JSON.stringify(card.sourceHash)}`);
  if (card.tags && card.tags.length > 0) lines.push(`tags: ${JSON.stringify(card.tags)}`);
  lines.push(`createdAt: ${JSON.stringify(card.createdAt)}`);
  lines.push('---');
  lines.push('');
  lines.push(FRONT_HEADING);
  lines.push('');
  lines.push(card.front);
  lines.push('');
  lines.push(BACK_HEADING);
  lines.push('');
  lines.push(card.back);
  if (card.sourceExcerpt) {
    lines.push('');
    lines.push('## Source');
    lines.push('');
    lines.push('> ' + card.sourceExcerpt.split('\n').join('\n> '));
  }
  lines.push('');
  return lines.join('\n');
}

export function decodeCardMarkdown(raw: string): FlashcardRecord | null {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return null;
  const fields = parseFrontmatter(match[1] ?? '');
  const body = match[2] ?? '';

  const id = asString(fields.id);
  const deck = asString(fields.deck);
  const createdAt = asString(fields.createdAt);
  if (!id || !deck || !createdAt) return null;

  const sections = splitSections(body);
  const front = sections.front.trim();
  const back = sections.back.trim();
  if (!front || !back) return null;

  const card: FlashcardRecord = { id, deck, front, back, createdAt };
  const sourceNoteId = asString(fields.sourceNoteId);
  if (sourceNoteId) card.sourceNoteId = sourceNoteId;
  const sourceHash = asString(fields.sourceHash);
  if (sourceHash) card.sourceHash = sourceHash;
  if (sections.source) card.sourceExcerpt = sections.source;
  const tags = asStringArray(fields.tags);
  if (tags) card.tags = tags;
  return card;
}

function splitSections(body: string): { front: string; back: string; source?: string } {
  const frontIndex = body.indexOf(FRONT_HEADING);
  const backIndex = body.indexOf(BACK_HEADING);
  if (frontIndex === -1 || backIndex === -1 || backIndex < frontIndex) {
    return { front: '', back: '' };
  }
  const front = body.slice(frontIndex + FRONT_HEADING.length, backIndex);
  const afterBack = body.slice(backIndex + BACK_HEADING.length);
  const sourceIndex = afterBack.indexOf('## Source');
  if (sourceIndex === -1) {
    return { front, back: afterBack };
  }
  const back = afterBack.slice(0, sourceIndex);
  const sourceQuoted = afterBack.slice(sourceIndex + '## Source'.length).trim();
  const source = sourceQuoted
    .split('\n')
    .map((line) => line.replace(/^>\s?/, ''))
    .join('\n')
    .trim();
  return { front, back, ...(source ? { source } : {}) };
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

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === 'string');
  return items.length > 0 ? items : undefined;
}
