import type {
  MemoryConfidence,
  MemoryRecord,
  MemoryScope,
  MemoryType,
} from '@piwin/contracts';
import { parseConfidence } from './confidence.js';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Serialize a memory record to markdown with simple YAML-like frontmatter.
 */
export function encodeMemoryMarkdown(record: MemoryRecord): string {
  const lines: string[] = ['---'];
  lines.push(`id: ${jsonScalar(record.id)}`);
  lines.push(`scope: ${jsonScalar(record.scope)}`);
  if (record.projectKey) {
    lines.push(`projectKey: ${jsonScalar(record.projectKey)}`);
  }
  lines.push(`type: ${jsonScalar(record.type)}`);
  if (record.title) {
    lines.push(`title: ${jsonScalar(record.title)}`);
  }
  lines.push(`confidence: ${jsonScalar(record.confidence)}`);
  if (record.quote) {
    lines.push(`quote: ${jsonScalar(record.quote)}`);
  }
  if (record.tags && record.tags.length > 0) {
    lines.push(`tags: ${JSON.stringify(record.tags)}`);
  }
  lines.push(`createdAt: ${jsonScalar(record.createdAt)}`);
  lines.push(`updatedAt: ${jsonScalar(record.updatedAt)}`);
  if (record.reviewedAt) {
    lines.push(`reviewedAt: ${jsonScalar(record.reviewedAt)}`);
  }
  lines.push('---');
  lines.push('');
  lines.push(record.content);
  if (!record.content.endsWith('\n')) {
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Parse markdown + frontmatter into a MemoryRecord.
 * Returns null when required fields are missing.
 */
export function decodeMemoryMarkdown(
  raw: string,
  relativePath: string,
): MemoryRecord | null {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    return null;
  }
  const frontmatter = match[1] ?? '';
  const body = (match[2] ?? '').replace(/^\n/, '');
  const fields = parseFrontmatter(frontmatter);

  const id = asString(fields.id);
  const scope = asScope(fields.scope);
  const type = asType(fields.type);
  const createdAt = asString(fields.createdAt);
  const updatedAt = asString(fields.updatedAt);
  if (!id || !scope || !type || !createdAt || !updatedAt) {
    return null;
  }

  const confidence: MemoryConfidence = parseConfidence(fields.confidence);
  const record: MemoryRecord = {
    id,
    scope,
    type,
    content: body.replace(/\s+$/, '') + (body.trim().length > 0 ? '' : ''),
    confidence,
    createdAt,
    updatedAt,
    relativePath,
  };
  // Normalize content: keep body as-is without forced trailing strip of all newlines oddly
  record.content = body.replace(/\n+$/, '\n').replace(/^\n+/, '');
  if (record.content.endsWith('\n') && record.content.length > 1) {
    record.content = record.content.slice(0, -1);
  }

  const projectKey = asString(fields.projectKey);
  if (projectKey) record.projectKey = projectKey;
  const title = asString(fields.title);
  if (title) record.title = title;
  const quote = asString(fields.quote);
  if (quote) record.quote = quote;
  const tags = asStringArray(fields.tags);
  if (tags) record.tags = tags;
  const reviewedAt = asString(fields.reviewedAt);
  if (reviewedAt) record.reviewedAt = reviewedAt;

  return record;
}

function jsonScalar(value: string): string {
  return JSON.stringify(value);
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
  if (raw.startsWith('[') || raw.startsWith('{') || raw.startsWith('"') || raw.startsWith("'")) {
    try {
      if (raw.startsWith("'") && raw.endsWith("'")) {
        return raw.slice(1, -1);
      }
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
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

function asScope(value: unknown): MemoryScope | undefined {
  return value === 'global' || value === 'project' ? value : undefined;
}

function asType(value: unknown): MemoryType | undefined {
  return value === 'user' ||
    value === 'feedback' ||
    value === 'project' ||
    value === 'reference' ||
    value === 'daily'
    ? value
    : undefined;
}
