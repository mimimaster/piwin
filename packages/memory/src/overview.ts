import type { MemoryRecord } from '@piwin/contracts';
import {
  DEFAULT_MAX_OVERVIEW_CHARS,
  MEMORY_OVERVIEW_HEADER,
  OVERVIEW_MAX_PER_BUCKET,
} from './constants.js';

export type BuildOverviewOptions = {
  /** Project-scoped records (preferred over global when same title/id). */
  projectRecords: MemoryRecord[];
  globalRecords: MemoryRecord[];
  maxChars?: number;
  maxPerBucket?: number;
};

/**
 * Build overview text for prompt injection.
 * Project memories shadow global by id; high-confidence first.
 */
export function buildOverviewText(options: BuildOverviewOptions): string {
  const maxChars = options.maxChars ?? DEFAULT_MAX_OVERVIEW_CHARS;
  const maxPerBucket = options.maxPerBucket ?? OVERVIEW_MAX_PER_BUCKET;

  const byId = new Map<string, MemoryRecord>();
  for (const record of options.globalRecords) {
    byId.set(record.id, record);
  }
  // Project shadows global for same id.
  for (const record of options.projectRecords) {
    byId.set(record.id, record);
  }

  const ranked = [...byId.values()].sort(compareForOverview);
  const lines: string[] = [MEMORY_OVERVIEW_HEADER, ''];

  const buckets = {
    high: [] as MemoryRecord[],
    medium: [] as MemoryRecord[],
    low: [] as MemoryRecord[],
    unknown: [] as MemoryRecord[],
  };
  for (const record of ranked) {
    buckets[record.confidence].push(record);
  }

  for (const confidence of ['high', 'medium', 'low', 'unknown'] as const) {
    const items = buckets[confidence].slice(0, maxPerBucket);
    if (items.length === 0) continue;
    lines.push(`## ${confidence}`);
    for (const record of items) {
      lines.push(formatOverviewLine(record));
    }
    lines.push('');
  }

  let text = lines.join('\n').trimEnd() + '\n';
  if (text.length > maxChars) {
    text = text.slice(0, Math.max(0, maxChars - 20)).trimEnd() + '\n…[truncated]\n';
  }
  return text;
}

function compareForOverview(left: MemoryRecord, right: MemoryRecord): number {
  const rank = (confidence: MemoryRecord['confidence']): number => {
    switch (confidence) {
      case 'high':
        return 0;
      case 'medium':
        return 1;
      case 'low':
        return 2;
      default:
        return 3;
    }
  };
  const confidenceDelta = rank(left.confidence) - rank(right.confidence);
  if (confidenceDelta !== 0) return confidenceDelta;
  return right.updatedAt.localeCompare(left.updatedAt);
}

function formatOverviewLine(record: MemoryRecord): string {
  const title = record.title?.trim() || record.content.trim().slice(0, 80) || record.id;
  const scopeTag = record.scope === 'project' ? 'project' : 'global';
  const tags =
    record.tags && record.tags.length > 0 ? ` tags=${record.tags.join(',')}` : '';
  return `- [${record.id}] (${scopeTag}/${record.type}${tags}) ${title}`;
}
