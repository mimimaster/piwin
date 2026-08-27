/**
 * Default Fork Chat title: `(1) <source>`, `(2) <source>`, …
 * The source session keeps its own name. Pure so Desktop mock and Host share
 * one policy without importing the Node-backed session store.
 */

const NUMBERED_PREFIX = /^\(\d+\)\s+/;
const LEGACY_BRANCH_SUFFIX = /\s*·\s*Branch(?:\s+\d+)?$/;

export function forkSessionTitleRoot(name: string): string {
  const trimmed = name.trim();
  const withoutNumber = trimmed.replace(NUMBERED_PREFIX, '');
  const withoutLegacy = withoutNumber.replace(LEGACY_BRANCH_SUFFIX, '').trim();
  return withoutLegacy.length > 0 ? withoutLegacy : trimmed;
}

export function buildForkSessionName(
  sourceName: string | undefined,
  sourceSessionId: string,
  existingForkNames: string[] = [],
): string {
  const base = (sourceName ?? `session-${sourceSessionId.slice(0, 8)}`).trim() || 'session';
  const rootName = forkSessionTitleRoot(base);
  const used = new Set<string>([base, ...existingForkNames]);
  let counter = 1;
  let candidate = `(${String(counter)}) ${rootName}`;
  while (used.has(candidate)) {
    counter += 1;
    candidate = `(${String(counter)}) ${rootName}`;
  }
  return candidate;
}
