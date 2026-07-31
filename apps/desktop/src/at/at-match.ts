/**
 * Filter and group `@` mention catalog items by query.
 */
import type { AtGroupLabel, AtItem, AtItemKind } from './at-types';

const KIND_RANK: Record<AtItemKind, number> = {
  context: 0,
  git: 1,
  mcp: 2,
  file: 3,
  folder: 4,
};

export const AT_MENU_MAX_ITEMS = 12;

function scoreAtItem(item: AtItem, queryLower: string): number | null {
  if (!queryLower) {
    return KIND_RANK[item.kind] * 100;
  }
  const name = item.name.toLowerCase();
  const label = item.label.toLowerCase();
  const description = item.description.toLowerCase();

  if (name === queryLower || label === queryLower) {
    return 0 + KIND_RANK[item.kind];
  }
  if (name.startsWith(queryLower) || label.startsWith(queryLower)) {
    return 10 + KIND_RANK[item.kind];
  }
  if (name.includes(queryLower) || label.includes(queryLower)) {
    return 30 + KIND_RANK[item.kind];
  }
  if (description.includes(queryLower)) {
    return 50 + KIND_RANK[item.kind];
  }
  return null;
}

export function filterAtItems(catalog: AtItem[], query: string): AtItem[] {
  const queryLower = query.trim().toLowerCase();
  const scored: Array<{ item: AtItem; score: number }> = [];
  for (const item of catalog) {
    const score = scoreAtItem(item, queryLower);
    if (score !== null) {
      scored.push({ item, score });
    }
  }
  scored.sort((a, b) => {
    if (a.score !== b.score) {
      return a.score - b.score;
    }
    return a.item.name.localeCompare(b.item.name);
  });
  return scored.slice(0, AT_MENU_MAX_ITEMS).map((entry) => entry.item);
}

export function groupAtItems(items: AtItem[]): Array<{
  groupLabel: AtGroupLabel;
  items: AtItem[];
}> {
  const order: AtGroupLabel[] = [
    'System Context',
    'Git Context',
    'MCP Server',
    'Workspace File',
  ];
  const buckets = new Map<AtGroupLabel, AtItem[]>();
  for (const label of order) {
    buckets.set(label, []);
  }
  for (const item of items) {
    const bucket = buckets.get(item.groupLabel);
    if (bucket) {
      bucket.push(item);
    }
  }
  return order
    .map((groupLabel) => ({
      groupLabel,
      items: buckets.get(groupLabel) ?? [],
    }))
    .filter((section) => section.items.length > 0);
}
