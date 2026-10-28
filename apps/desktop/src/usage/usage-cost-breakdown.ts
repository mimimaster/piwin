/**
 * Pure grouping for the 费用构成 table.
 *
 * The Host reports one row per model × Key. The table can merge those rows by
 * model or by Key (the merged parts become expandable children) or keep them
 * flat. Rows with no priced call are kept apart from the ranked rows, so an
 * unknown `—` never sorts between real amounts and never counts as free.
 */
import { computePromptCacheHitRate, type UsageModelKeyTotal } from '@piwin/contracts';

export type UsageCostGrouping = 'model' | 'key' | 'model-key';
export type UsageCostSortKey = 'cost' | 'calls' | 'tokens';

export type UsageCostFigures = {
  /** Priced calls only; undefined when none of the calls could be priced. */
  costUsd: number | undefined;
  calls: number;
  pricedCalls: number;
  unpricedCalls: number;
  tokens: number;
  cacheHitRate: number | null;
  /** Average over priced calls only. */
  perCallUsd: number | undefined;
  /** Fraction of the priced total; undefined for unpriced rows. */
  share: number | undefined;
  /** Bar length relative to the most expensive row in the same list, 0–1. */
  barRatio: number;
};

export type UsageCostLeafRow = UsageCostFigures & {
  id: string;
  label: string;
};

export type UsageCostGroupRow = UsageCostLeafRow & {
  /** Model id or Key name the row stands for; Key rows use the Key label. */
  kind: 'model' | 'key';
  /** Secondary label: the single Key/model, or a count when merged. */
  secondary: { kind: 'key' | 'model'; values: string[] };
  /** Catalog reference used for pricing, when it differs from the label. */
  reference?: string;
  /** Merged parts; empty when the group holds a single model × Key row. */
  children: UsageCostLeafRow[];
};

export type UsageCostUnpricedRow = UsageCostLeafRow & { key: string };

export type UsageCostBreakdown = {
  priced: UsageCostGroupRow[];
  /** Model × Key rows with no priced call at all, flat. */
  unpriced: UsageCostUnpricedRow[];
  pricedTotal: UsageCostFigures;
  unpricedTotal: UsageCostFigures;
};

export const UNKNOWN_KEY_LABEL = '\u0000unknown-key';

/** Model ids often carry a router path (`cursor/grok-4.6`); split it so the model reads first. */
export function splitUsageModelRoute(modelId: string): { route: string; name: string } {
  const slash = modelId.lastIndexOf('/');
  if (slash < 0 || slash === modelId.length - 1) return { route: '', name: modelId };
  return { route: modelId.slice(0, slash + 1), name: modelId.slice(slash + 1) };
}

export function buildUsageCostBreakdown(
  rows: readonly UsageModelKeyTotal[],
  grouping: UsageCostGrouping,
  sort: UsageCostSortKey = 'cost',
): UsageCostBreakdown {
  const pricedRows = rows.filter(hasPricedCalls);
  const unpricedRows = rows.filter((row) => !hasPricedCalls(row));
  const pricedTotal = sumFigures(pricedRows);
  const totalUsd = pricedTotal.costUsd ?? 0;

  const buckets = new Map<string, UsageModelKeyTotal[]>();
  for (const row of pricedRows) {
    const id = groupId(row, grouping);
    const bucket = buckets.get(id);
    if (bucket) bucket.push(row);
    else buckets.set(id, [row]);
  }

  const groups = [...buckets.entries()].map(([id, members]) => buildGroup(id, members, grouping));
  groups.sort((left, right) => compareFigures(left, right, sort));
  const maxCost = Math.max(0, ...groups.map((group) => group.costUsd ?? 0));
  for (const group of groups) {
    applyShare(group, totalUsd, maxCost);
    for (const child of group.children) applyShare(child, totalUsd, maxCost);
  }

  const unpriced = unpricedRows
    .map((row) => ({ id: groupId(row, 'model-key'), label: row.modelId, key: keyLabel(row), ...sumFigures([row]) }))
    .sort((left, right) => right.calls - left.calls);

  return { priced: groups, unpriced, pricedTotal, unpricedTotal: sumFigures(unpricedRows) };
}

function hasPricedCalls(row: UsageModelKeyTotal): boolean {
  return (row.pricedEntryCount ?? 0) > 0 && row.estimatedCostUsd !== undefined;
}

function keyLabel(row: UsageModelKeyTotal): string {
  return row.providerId ?? UNKNOWN_KEY_LABEL;
}

function groupId(row: UsageModelKeyTotal, grouping: UsageCostGrouping): string {
  if (grouping === 'model') return `m:${row.modelId}`;
  if (grouping === 'key') return `k:${keyLabel(row)}`;
  return JSON.stringify([row.modelId, row.providerId]);
}

function buildGroup(id: string, members: UsageModelKeyTotal[], grouping: UsageCostGrouping): UsageCostGroupRow {
  const first = members[0];
  if (!first) throw new Error('usage cost group without members');
  const byKey = grouping === 'key';
  const children = members.length > 1
    ? members
      .map((row) => ({
        id: groupId(row, 'model-key'),
        label: byKey ? row.modelId : keyLabel(row),
        ...sumFigures([row]),
      }))
      .sort((left, right) => (right.costUsd ?? -1) - (left.costUsd ?? -1))
    : [];
  const secondaryValues = byKey
    ? uniqueSorted(members.map((row) => row.modelId))
    : uniqueSorted(members.map(keyLabel));
  const reference = byKey ? undefined : sharedReference(members);
  return {
    id,
    kind: byKey ? 'key' : 'model',
    label: byKey ? keyLabel(first) : first.modelId,
    secondary: { kind: byKey ? 'model' : 'key', values: secondaryValues },
    ...(reference ? { reference } : {}),
    children,
    ...sumFigures(members),
  };
}

function sharedReference(members: readonly UsageModelKeyTotal[]): string | undefined {
  const references = new Set(members.map((row) => row.costReference).filter((value) => value !== undefined));
  const [reference] = references;
  const first = members[0];
  if (references.size !== 1 || !reference || !first || reference === first.modelId) return undefined;
  // `openai/gpt-5` for a row named `gpt-5` adds nothing worth a tooltip.
  return reference.endsWith(`/${first.modelId}`) ? undefined : reference;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sumFigures(rows: readonly UsageModelKeyTotal[]): UsageCostFigures {
  let calls = 0;
  let pricedCalls = 0;
  let tokens = 0;
  let promptTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let costUsd: number | undefined;
  for (const row of rows) {
    calls += row.entryCount;
    tokens += row.totalTokens;
    promptTokens += row.promptTokens;
    cacheReadTokens += row.cacheReadTokens;
    cacheWriteTokens += row.cacheWriteTokens;
    if (hasPricedCalls(row)) {
      pricedCalls += Math.min(row.pricedEntryCount ?? 0, row.entryCount);
      costUsd = (costUsd ?? 0) + (row.estimatedCostUsd ?? 0);
    }
  }
  return {
    costUsd,
    calls,
    pricedCalls,
    unpricedCalls: calls - pricedCalls,
    tokens,
    cacheHitRate: computePromptCacheHitRate({ promptTokens, cacheReadTokens, cacheWriteTokens }),
    perCallUsd: costUsd !== undefined && pricedCalls > 0 ? costUsd / pricedCalls : undefined,
    share: undefined,
    barRatio: 0,
  };
}

function applyShare(figures: UsageCostFigures, totalUsd: number, maxCost: number): void {
  if (figures.costUsd === undefined) return;
  figures.share = totalUsd > 0 ? figures.costUsd / totalUsd : 0;
  figures.barRatio = maxCost > 0 ? figures.costUsd / maxCost : 0;
}

function compareFigures(left: UsageCostFigures, right: UsageCostFigures, sort: UsageCostSortKey): number {
  const pick = (figures: UsageCostFigures): number =>
    sort === 'calls' ? figures.calls : sort === 'tokens' ? figures.tokens : figures.costUsd ?? -1;
  const delta = pick(right) - pick(left);
  if (delta !== 0) return delta;
  return right.tokens - left.tokens;
}
