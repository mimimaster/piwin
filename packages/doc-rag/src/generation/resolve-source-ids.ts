/**
 * Map model-invented source ids onto real ContextPack chunk ids.
 *
 * Ingest hashes are 64-hex strings. Models almost never copy them verbatim —
 * they return "1", "chunk 1", a path, or a prefix. Without this mapping the
 * two-stage parser drops every knowledge point and generate fails with
 * NO_VALID_FLASHCARDS even when the prose is grounded in the pack.
 */
import type { ContextPack } from '@piwin/contracts';

export function resolveSourceIds(rawIds: string[], pack: ContextPack): string[] {
  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawIds) {
    const match = matchSourceId(raw, pack);
    if (match && !seen.has(match)) {
      seen.add(match);
      resolved.push(match);
    }
  }
  return resolved;
}

export function fallbackPackSourceId(pack: ContextPack): string | undefined {
  return pack.sources[0]?.chunkId;
}

function matchSourceId(raw: string, pack: ContextPack): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const exact = pack.sources.find((source) => source.chunkId === trimmed);
  if (exact) return exact.chunkId;

  const lower = trimmed.toLowerCase();
  const hexPrefix = lower.replace(/[^a-f0-9]/g, '');
  if (hexPrefix.length >= 8) {
    const prefixHits = pack.sources.filter((source) =>
      source.chunkId.toLowerCase().startsWith(hexPrefix),
    );
    if (prefixHits.length === 1) return prefixHits[0]?.chunkId;
  }

  const pathHits = pack.sources.filter(
    (source) =>
      source.relativePath === trimmed ||
      source.relativePath.endsWith(trimmed) ||
      source.documentId === trimmed,
  );
  if (pathHits.length === 1) return pathHits[0]?.chunkId;

  const indexMatch = lower.match(/^(?:chunk|source|passage|excerpt|#)?\s*(\d+)$/);
  if (indexMatch) {
    const oneBased = Number(indexMatch[1]);
    if (Number.isInteger(oneBased) && oneBased >= 1 && oneBased <= pack.sources.length) {
      return pack.sources[oneBased - 1]?.chunkId;
    }
    if (Number.isInteger(oneBased) && oneBased >= 0 && oneBased < pack.sources.length) {
      return pack.sources[oneBased]?.chunkId;
    }
  }
  return undefined;
}
