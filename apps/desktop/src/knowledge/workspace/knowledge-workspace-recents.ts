/**
 * Continue-reading list for the overview. Host has no recents command; the
 * last few opens live in this browser so returning to Knowledge lands on them.
 */

export type KnowledgeRecentRead =
  | {
      kind: 'document';
      title: string;
      openedAt: string;
      baseId: string;
      relativePath: string;
      startLine?: number;
    }
  | {
      kind: 'wiki';
      title: string;
      openedAt: string;
      slug: string;
    };

const STORAGE_KEY = 'piwin:knowledge-recent-reads';
const MAX_RECENTS = 8;

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readKnowledgeRecentReads(): KnowledgeRecentRead[] {
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecent).slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

export function rememberKnowledgeRecentRead(entry: KnowledgeRecentRead): KnowledgeRecentRead[] {
  const next = [
    entry,
    ...readKnowledgeRecentReads().filter((item) => !sameRecent(item, entry)),
  ].slice(0, MAX_RECENTS);
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // quota / private mode
  }
  return next;
}

function sameRecent(left: KnowledgeRecentRead, right: KnowledgeRecentRead): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'document' && right.kind === 'document') {
    return left.baseId === right.baseId && left.relativePath === right.relativePath;
  }
  if (left.kind === 'wiki' && right.kind === 'wiki') return left.slug === right.slug;
  return false;
}

function isRecent(value: unknown): value is KnowledgeRecentRead {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (typeof record.title !== 'string' || typeof record.openedAt !== 'string') return false;
  if (record.kind === 'document') {
    return typeof record.baseId === 'string' && typeof record.relativePath === 'string';
  }
  if (record.kind === 'wiki') return typeof record.slug === 'string';
  return false;
}
