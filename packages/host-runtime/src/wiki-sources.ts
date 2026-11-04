import { createHash } from 'node:crypto';
import type { WikiPageKind, WikiSourceRef } from '@piwin/contracts';

const WIKI_PAGE_KINDS = new Set<WikiPageKind>(['concept', 'note', 'topic']);

export function hashWikiRaw(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function parseWikiPageKind(value: unknown): WikiPageKind | undefined {
  if (typeof value !== 'string') return undefined;
  return WIKI_PAGE_KINDS.has(value as WikiPageKind) ? (value as WikiPageKind) : undefined;
}

export function parseWikiSources(value: unknown): WikiSourceRef[] {
  if (!Array.isArray(value)) return [];
  const sources: WikiSourceRef[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (typeof record.baseId !== 'string' || record.baseId.length === 0) continue;
    if (typeof record.relativePath !== 'string' || record.relativePath.length === 0) continue;
    const lineStart =
      typeof record.lineStart === 'number' && Number.isInteger(record.lineStart) && record.lineStart >= 1
        ? record.lineStart
        : undefined;
    const lineEnd =
      typeof record.lineEnd === 'number' && Number.isInteger(record.lineEnd) && record.lineEnd >= 1
        ? record.lineEnd
        : undefined;
    const snapshotText =
      typeof record.snapshotText === 'string' && record.snapshotText.length > 0
        ? record.snapshotText
        : undefined;
    sources.push({
      baseId: record.baseId,
      relativePath: record.relativePath,
      ...(lineStart !== undefined ? { lineStart } : {}),
      ...(lineEnd !== undefined ? { lineEnd } : {}),
      ...(snapshotText !== undefined ? { snapshotText } : {}),
    });
  }
  return sources;
}
