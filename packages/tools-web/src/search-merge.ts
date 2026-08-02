import type { SearchHit } from '@piwin/contracts';

export type SourceHitBatch = {
  sourceId: string;
  hits: SearchHit[];
};

/**
 * Normalize URL for dedupe: lowercase host, drop hash, drop trailing slash on path.
 * Tracking params are left alone in v1 (keeps diffs small and predictable).
 */
export function normalizeSearchHitUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return rawUrl.trim();
  }
}

/**
 * Merge multi-source hit lists with URL dedupe and round-robin ranking.
 * Later sources that share a URL are dropped (first seen wins for title/snippet).
 */
export function mergeSearchHitBatches(
  batches: readonly SourceHitBatch[],
  maxResults: number,
): SearchHit[] {
  const limit = Math.min(Math.max(maxResults, 1), 50);
  const seenUrls = new Set<string>();
  const queues = batches.map((batch) =>
    batch.hits.map((hit) => ({
      ...hit,
      source: hit.source ?? batch.sourceId,
    })),
  );

  const merged: SearchHit[] = [];
  let index = 0;
  let remaining = queues.some((queue) => queue.length > 0);
  while (remaining && merged.length < limit) {
    remaining = false;
    for (const queue of queues) {
      if (index >= queue.length) {
        continue;
      }
      remaining = true;
      const candidate = queue[index];
      if (!candidate) {
        continue;
      }
      const key = normalizeSearchHitUrl(candidate.url);
      if (!key || seenUrls.has(key)) {
        continue;
      }
      seenUrls.add(key);
      merged.push(candidate);
      if (merged.length >= limit) {
        break;
      }
    }
    index += 1;
  }
  return merged;
}
