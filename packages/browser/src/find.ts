import type { BrowserSnapshotNode } from '@piwin/contracts';

/** Model-facing cap on returned candidates (spec §6.3). */
export const BROWSER_FIND_MAX_CANDIDATES = 20;

export type BrowserFindCandidate = {
  text: string;
  ref?: string;
  selector?: string;
};

export type BrowserFindResult = {
  /** Total accessibility-name matches, not just the returned page of them. */
  count: number;
  candidates: BrowserFindCandidate[];
  truncated: boolean;
};

type WalkableNode = Pick<BrowserSnapshotNode, 'name' | 'ref' | 'children'>;

/**
 * `browser_find` returns candidates that are already usable as click/type
 * targets. Refs come from the same accessibility snapshot as
 * `browser_snapshot`; when a node has no ref we return text only rather than
 * inventing a selector the model cannot trust (spec §6.3).
 */
export function collectFindCandidates(
  nodes: readonly WalkableNode[],
  text: string,
  limit: number = BROWSER_FIND_MAX_CANDIDATES,
): BrowserFindResult {
  const needle = text.trim().toLowerCase();
  if (needle.length === 0) {
    return { count: 0, candidates: [], truncated: false };
  }
  const candidates: BrowserFindCandidate[] = [];
  let count = 0;

  const visit = (node: WalkableNode): void => {
    const name = node.name;
    if (typeof name === 'string' && name.toLowerCase().includes(needle)) {
      count += 1;
      if (candidates.length < limit) {
        candidates.push({
          text: name,
          ...(typeof node.ref === 'string' && node.ref.length > 0 ? { ref: node.ref } : {}),
        });
      }
    }
    for (const child of node.children ?? []) visit(child);
  };

  for (const node of nodes) visit(node);
  return { count, candidates, truncated: count > candidates.length };
}
