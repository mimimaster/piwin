import type { NoteRecord } from '@piwin/contracts';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Serialize a note to markdown with JSON-scalar frontmatter (memory-codec style). */
export function encodeNoteMarkdown(record: NoteRecord): string {
  const lines: string[] = ['---'];
  lines.push(`id: ${JSON.stringify(record.id)}`);
  lines.push(`title: ${JSON.stringify(record.title)}`);
  if (record.tags && record.tags.length > 0) {
    lines.push(`tags: ${JSON.stringify(record.tags)}`);
  }
  lines.push(`createdAt: ${JSON.stringify(record.createdAt)}`);
  lines.push(`updatedAt: ${JSON.stringify(record.updatedAt)}`);
  lines.push('---');
  lines.push('');
  lines.push(record.content);
  if (!record.content.endsWith('\n')) {
    lines.push('');
  }
  return lines.join('\n');
}

export type DecodedNote = {
  id: string;
  title: string;
  content: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
};

/**
 * Parse markdown + frontmatter. Files without valid frontmatter (external
 * drops) are tolerated by the store layer, not here — this returns null so
 * the caller can synthesize metadata from the file itself.
 */
export function decodeNoteMarkdown(raw: string): DecodedNote | null {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    return null;
  }
  const fields = parseFrontmatter(match[1] ?? '');
  const body = normalizeBody(match[2] ?? '');

  const id = asString(fields.id);
  const title = asString(fields.title);
  const createdAt = asString(fields.createdAt);
  const updatedAt = asString(fields.updatedAt);
  if (!id || !title || !createdAt || !updatedAt) {
    return null;
  }

  const decoded: DecodedNote = { id, title, content: body, createdAt, updatedAt };
  const tags = asStringArray(fields.tags);
  if (tags) decoded.tags = tags;
  return decoded;
}

function normalizeBody(body: string): string {
  return body.replace(/^\n+/, '').replace(/\n+$/, '');
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
    result[key] = parseYamlishValue(rawValue);
  }
  return result;
}

function parseYamlishValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null' || raw === '') return null;
  if (raw.startsWith('[') || raw.startsWith('{') || raw.startsWith('"')) {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
    return raw.slice(1, -1);
  }
  return raw;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === 'string');
  return items.length > 0 ? items : undefined;
}
