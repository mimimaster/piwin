/**
 * Filter and rank slash menu items by query.
 */
import type { SlashItem, SlashItemKind } from './slash-types';

const KIND_RANK: Record<SlashItemKind, number> = {
  command: 0,
  mode: 1,
  skill: 2,
};

export const SLASH_MENU_MAX_ITEMS = 24;

/**
 * Score an item against query (lower is better). Returns null if no match.
 */
function scoreSlashItem(item: SlashItem, queryLower: string): number | null {
  if (!queryLower) {
    return KIND_RANK[item.kind] * 1000;
  }
  const name = item.name.toLowerCase();
  const aliases = (item.aliases ?? []).map((alias) => alias.toLowerCase());
  const label = item.label.toLowerCase();
  const description = item.description.toLowerCase();
  const keywords = (item.keywords ?? []).map((keyword) => keyword.toLowerCase()).join(' ');

  if (name === queryLower || aliases.includes(queryLower)) {
    return 0 + KIND_RANK[item.kind];
  }
  if (name.startsWith(queryLower)) {
    return 10 + KIND_RANK[item.kind];
  }
  if (aliases.some((alias) => alias.startsWith(queryLower))) {
    return 15 + KIND_RANK[item.kind];
  }
  if (name.includes(queryLower) || aliases.some((alias) => alias.includes(queryLower))) {
    return 30 + KIND_RANK[item.kind];
  }
  if (label.includes(queryLower)) {
    return 40 + KIND_RANK[item.kind];
  }
  if (keywords.includes(queryLower) || description.includes(queryLower)) {
    return 50 + KIND_RANK[item.kind];
  }
  return null;
}

/**
 * Filter catalog by query and return up to SLASH_MENU_MAX_ITEMS ranked items.
 * Empty query returns default top list (all commands, all modes, then skills).
 *
 * The result is in menu display order: sections ordered by their best match,
 * items ranked within each section. The composer indexes this array for
 * keyboard selection, so it must match what `groupSlashItems` renders.
 */
export function filterSlashItems(catalog: SlashItem[], query: string): SlashItem[] {
  const queryLower = query.trim().toLowerCase();
  const scored: Array<{ item: SlashItem; score: number }> = [];
  for (const item of catalog) {
    const score = scoreSlashItem(item, queryLower);
    if (score === null) {
      continue;
    }
    scored.push({ item, score });
  }
  scored.sort((left, right) => {
    if (left.score !== right.score) {
      return left.score - right.score;
    }
    return left.item.name.localeCompare(right.item.name);
  });
  const ranked = scored.slice(0, SLASH_MENU_MAX_ITEMS).map((entry) => entry.item);
  return groupSlashItems(ranked).flatMap((section) => section.items);
}

/**
 * Group filtered items for section headers. Sections appear in the order of
 * their first item, so ranked input keeps its best match on top.
 */
export function groupSlashItems(items: SlashItem[]): Array<{
  groupLabel: SlashItem['groupLabel'];
  items: SlashItem[];
}> {
  const buckets = new Map<SlashItem['groupLabel'], SlashItem[]>();
  for (const item of items) {
    const bucket = buckets.get(item.groupLabel);
    if (bucket) {
      bucket.push(item);
    } else {
      buckets.set(item.groupLabel, [item]);
    }
  }
  return [...buckets].map(([groupLabel, sectionItems]) => ({ groupLabel, items: sectionItems }));
}
