import type { MemoryRecord, MemorySearchHit, MemorySearchQuery } from '@piwin/contracts';

/**
 * Simple token/substring search over scanned records.
 * Upgrade path: better-sqlite3 FTS on memory-index.sqlite3 (see package README).
 */
export function searchMemoryRecords(
  records: MemoryRecord[],
  query: MemorySearchQuery,
): MemorySearchHit[] {
  const raw = query.query.trim().toLowerCase();
  if (!raw) {
    return [];
  }
  const tokens = raw.split(/\s+/).filter(Boolean);
  const limit = query.limit && query.limit > 0 ? Math.floor(query.limit) : 20;

  const hits: MemorySearchHit[] = [];
  for (const record of records) {
    if (query.scope && record.scope !== query.scope) continue;
    if (query.projectKey && record.projectKey !== query.projectKey) continue;

    const haystack = buildHaystack(record);
    let score = 0;
    for (const token of tokens) {
      if (haystack.includes(token)) {
        score += token.length;
        if (record.title?.toLowerCase().includes(token)) score += 5;
        if (record.id.toLowerCase().includes(token)) score += 3;
      }
    }
    if (score <= 0 && !haystack.includes(raw)) {
      continue;
    }
    if (score <= 0) {
      score = raw.length;
    }
    hits.push({
      record,
      score,
      snippet: makeSnippet(record, tokens[0] ?? raw),
    });
  }

  hits.sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
  return hits.slice(0, limit);
}

function buildHaystack(record: MemoryRecord): string {
  const parts = [
    record.id,
    record.title ?? '',
    record.content,
    record.quote ?? '',
    ...(record.tags ?? []),
    record.type,
    record.scope,
  ];
  return parts.join('\n').toLowerCase();
}

function makeSnippet(record: MemoryRecord, token: string): string {
  const content = record.content;
  const lower = content.toLowerCase();
  const index = lower.indexOf(token.toLowerCase());
  if (index === -1) {
    return content.slice(0, 160);
  }
  const start = Math.max(0, index - 40);
  const end = Math.min(content.length, index + token.length + 80);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < content.length ? '…' : '';
  return `${prefix}${content.slice(start, end)}${suffix}`;
}
