/** Insertion-order record budgets for Desktop shell caches. */

export const MAX_RECENT_PROJECTS = 16;
export const MAX_SESSION_PLAN_CACHE = 32;
export const MAX_JOB_LOGS_BY_ID = 32;
export const MAX_SUBAGENT_CHILDREN = 64;
export const MAX_SUBAGENT_INVOCATIONS = 128;
export const MAX_SUBAGENT_BATCHES = 32;
export const MAX_SUBAGENT_TASK_RESULTS = 128;
export const MAX_PTY_OUTPUT_LINES = 999;
export const MAX_PTY_OUTPUT_BYTES = 512_000;
export const MAX_EXTENSION_DEPLOYMENT_ANNOUNCEMENTS = 64;

/** Touch `key` as newest, then drop oldest unprotected keys past `maxKeys`. */
export function putRecordLru<T>(
  current: Readonly<Record<string, T>>,
  key: string,
  value: T,
  maxKeys: number,
  protectKeys: readonly string[] = [],
): Record<string, T> {
  const next: Record<string, T> = { ...current };
  delete next[key];
  next[key] = value;
  const keys = Object.keys(next);
  if (keys.length <= maxKeys) {
    return next;
  }
  const protectedSet = new Set(protectKeys.filter((item) => item.length > 0 && item !== key));
  let overflow = keys.length - maxKeys;
  for (const stale of keys) {
    if (overflow <= 0) {
      break;
    }
    if (stale === key || protectedSet.has(stale)) {
      continue;
    }
    delete next[stale];
    overflow -= 1;
  }
  return next;
}

export function retainRecordKeys<T>(
  current: Readonly<Record<string, T>>,
  keepKeys: readonly string[],
): Record<string, T> {
  const keep = new Set(keepKeys);
  const next: Record<string, T> = {};
  for (const key of Object.keys(current)) {
    if (!keep.has(key)) {
      continue;
    }
    const value = current[key];
    if (value !== undefined) {
      next[key] = value;
    }
  }
  return next;
}

/** Drop oldest completed entries first; only then drop remaining oldest keys. */
export function evictCompletedFirst<T>(
  current: Readonly<Record<string, T>>,
  maxKeys: number,
  isCompleted: (value: T) => boolean,
): Record<string, T> {
  const keys = Object.keys(current);
  if (keys.length <= maxKeys) {
    return current as Record<string, T>;
  }
  let overflow = keys.length - maxKeys;
  const next: Record<string, T> = { ...current };
  for (const key of keys) {
    if (overflow <= 0) {
      break;
    }
    const value = next[key];
    if (value === undefined || !isCompleted(value)) {
      continue;
    }
    delete next[key];
    overflow -= 1;
  }
  if (overflow > 0) {
    for (const key of Object.keys(next)) {
      if (overflow <= 0) {
        break;
      }
      delete next[key];
      overflow -= 1;
    }
  }
  return next;
}

export function capSeenKeys(seenKeys: Set<string>, maxKeys: number): void {
  while (seenKeys.size > maxKeys) {
    const oldest = seenKeys.values().next().value;
    if (oldest === undefined) {
      return;
    }
    seenKeys.delete(oldest);
  }
}

export function appendBoundedPtyOutput<T extends { data: string }>(
  current: readonly T[],
  line: T,
  maxLines = MAX_PTY_OUTPUT_LINES,
  maxBytes = MAX_PTY_OUTPUT_BYTES,
): T[] {
  const next = [...current.slice(1 - maxLines), line];
  let bytes = 0;
  let start = 0;
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const item = next[index];
    if (item === undefined) {
      continue;
    }
    bytes += item.data.length;
    if (bytes > maxBytes) {
      start = Math.min(index + 1, next.length - 1);
      break;
    }
  }
  return start === 0 ? next : next.slice(start);
}
