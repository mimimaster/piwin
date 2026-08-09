/**
 * Build a default fork name: `<source name> · Branch`, `· Branch 2`, etc.
 * Pure so browser shells and Host-side session operations share one policy
 * without importing the Node-backed session store.
 */
export function buildForkSessionName(
  sourceName: string | undefined,
  sourceSessionId: string,
  existingForkNames: string[] = [],
): string {
  const base = (sourceName ?? `session-${sourceSessionId.slice(0, 8)}`).trim() || 'session';
  const rootName = base.replace(/\s*·\s*Branch(\s+\d+)?$/, '');
  const firstCandidate = `${rootName} · Branch`;
  if (!existingForkNames.includes(firstCandidate)) {
    return firstCandidate;
  }
  let counter = 2;
  while (existingForkNames.includes(`${rootName} · Branch ${counter}`)) {
    counter += 1;
  }
  return `${rootName} · Branch ${counter}`;
}
