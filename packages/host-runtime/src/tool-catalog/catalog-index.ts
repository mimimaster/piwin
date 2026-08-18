/**
 * Pure Host-target catalog matching. MCP search stays in catalog-service;
 * this module only ranks local toolbox targets and shared hit ordering.
 */

import type { HostToolDescriptor, HostToolRegistration } from '@piwin/contracts';
import { compactModelToolDescriptor } from '../model-tool-descriptor.js';

export const CATALOG_SEARCH_SCHEMA_TOP_K = 3;
export const CATALOG_SEARCH_OUTPUT_MAX_CHARS = 12_000;
export const CATALOG_SEARCH_DEFAULT_LIMIT = 20;
export const CATALOG_SEARCH_MAX_LIMIT = 50;
export const CATALOG_SUGGESTION_LIMIT = 3;

export type CatalogEntrySource = 'host' | 'mcp';

export type CatalogSearchHit = {
  id: string;
  source: CatalogEntrySource;
  description: string;
  schema?: HostToolDescriptor;
  exact: boolean;
  prefix: boolean;
  keywordHits: number;
};

export function isMcpCatalogTarget(target: string): boolean {
  return target.includes('.') && !target.includes('/') && !target.startsWith('.');
}

export function clampCatalogSearchLimit(limit: unknown): number {
  if (typeof limit === 'number' && Number.isFinite(limit)) {
    return Math.min(CATALOG_SEARCH_MAX_LIMIT, Math.max(1, Math.floor(limit)));
  }
  return CATALOG_SEARCH_DEFAULT_LIMIT;
}

export function searchHostCatalog(
  targets: readonly HostToolRegistration[],
  query: string,
): CatalogSearchHit[] {
  const hits: CatalogSearchHit[] = [];
  for (const target of targets) {
    const descriptor = compactModelToolDescriptor(target.descriptor);
    const haystack = buildHostHaystack(descriptor);
    const scored = scoreCatalogQuery(descriptor.name, haystack, query);
    if (!scored.matched) {
      continue;
    }
    hits.push({
      id: descriptor.name,
      source: 'host',
      description: descriptor.description,
      schema: descriptor,
      exact: scored.exact,
      prefix: scored.prefix,
      keywordHits: scored.keywordHits,
    });
  }
  return rankCatalogHits(hits);
}

export function scoreCatalogQuery(
  id: string,
  haystack: string,
  query: string,
): { matched: boolean; exact: boolean; prefix: boolean; keywordHits: number } {
  const normalizedId = id.trim().toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedHaystack = haystack.toLowerCase();
  if (!normalizedQuery) {
    return { matched: true, exact: false, prefix: false, keywordHits: 0 };
  }
  const tokens = tokenizeCatalogQuery(normalizedQuery);
  const exact = normalizedId === normalizedQuery || lastSegment(normalizedId) === normalizedQuery;
  const prefix =
    normalizedId.startsWith(normalizedQuery) ||
    lastSegment(normalizedId).startsWith(normalizedQuery);
  let keywordHits = 0;
  for (const token of tokens) {
    if (normalizedHaystack.includes(token) || normalizedId.includes(token)) {
      keywordHits += 1;
    }
  }
  const matched = exact || prefix || keywordHits > 0;
  return { matched, exact, prefix, keywordHits };
}

export function rankCatalogHits(hits: readonly CatalogSearchHit[]): CatalogSearchHit[] {
  return [...hits].sort((left, right) => {
    if (left.exact !== right.exact) {
      return left.exact ? -1 : 1;
    }
    if (left.prefix !== right.prefix) {
      return left.prefix ? -1 : 1;
    }
    if (left.keywordHits !== right.keywordHits) {
      return right.keywordHits - left.keywordHits;
    }
    return left.id.localeCompare(right.id);
  });
}

export function suggestCatalogIds(ids: readonly string[], target: string): string[] {
  const normalizedTarget = target.trim().toLowerCase();
  if (!normalizedTarget) {
    return [];
  }
  const ranked = [...new Set(ids)]
    .map((id) => {
      const normalizedId = id.toLowerCase();
      const distance = levenshteinDistance(normalizedId, normalizedTarget);
      const prefix =
        normalizedId.startsWith(normalizedTarget) || normalizedTarget.startsWith(normalizedId);
      return { id, distance, prefix };
    })
    .filter((entry) => entry.prefix || entry.distance <= 2)
    .sort((left, right) => {
      if (left.prefix !== right.prefix) {
        return left.prefix ? -1 : 1;
      }
      if (left.distance !== right.distance) {
        return left.distance - right.distance;
      }
      return left.id.localeCompare(right.id);
    })
    .slice(0, CATALOG_SUGGESTION_LIMIT)
    .map((entry) => entry.id);
  return ranked.filter((id) => id.toLowerCase() !== normalizedTarget);
}

export function applyCatalogSearchBudget(
  hits: readonly CatalogSearchHit[],
  topK: number = CATALOG_SEARCH_SCHEMA_TOP_K,
): { tools: CatalogSearchHit[]; truncated: boolean } {
  let schemaCount = Math.min(topK, hits.length);
  const projected = (count: number): CatalogSearchHit[] =>
    hits.map((hit, index) => {
      if (index < count) {
        return hit;
      }
      const { schema: _schema, ...rest } = hit;
      return rest;
    });

  while (schemaCount > 1) {
    const serialized = JSON.stringify({ tools: projected(schemaCount) });
    if (serialized.length <= CATALOG_SEARCH_OUTPUT_MAX_CHARS) {
      return { tools: projected(schemaCount), truncated: false };
    }
    schemaCount -= 1;
  }

  const withOneSchema = projected(Math.min(1, hits.length));
  const serialized = JSON.stringify({ tools: withOneSchema });
  if (serialized.length <= CATALOG_SEARCH_OUTPUT_MAX_CHARS) {
    return { tools: withOneSchema, truncated: false };
  }

  const withoutSchemas = hits.map((hit) => {
    const { schema: _schema, ...rest } = hit;
    return rest;
  });
  const trimmed: CatalogSearchHit[] = [];
  for (const hit of withoutSchemas) {
    const candidate = [...trimmed, hit];
    if (JSON.stringify({ tools: candidate, truncated: true }).length > CATALOG_SEARCH_OUTPUT_MAX_CHARS) {
      return { tools: trimmed, truncated: true };
    }
    trimmed.push(hit);
  }
  return { tools: trimmed, truncated: trimmed.length < hits.length };
}

function buildHostHaystack(descriptor: HostToolDescriptor): string {
  return `${descriptor.name} ${descriptor.description} ${collectSchemaText(descriptor.parameters)}`;
}

function collectSchemaText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((child) => collectSchemaText(child)).join(' ');
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, child]) => `${key} ${collectSchemaText(child)}`)
      .join(' ');
  }
  return '';
}

function tokenizeCatalogQuery(query: string): string[] {
  return query.split(/[^a-z0-9]+/i).filter((token) => token.length > 0);
}

function lastSegment(id: string): string {
  const parts = id.split(/[._-]/);
  return parts[parts.length - 1] ?? id;
}

function levenshteinDistance(left: string, right: string): number {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array.from({ length: columns }, () => 0));
  for (let row = 0; row < rows; row += 1) {
    const currentRow = matrix[row];
    if (!currentRow) {
      continue;
    }
    currentRow[0] = row;
  }
  const firstRow = matrix[0];
  if (firstRow) {
    for (let column = 0; column < columns; column += 1) {
      firstRow[column] = column;
    }
  }
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const currentRow = matrix[row];
      const previousRow = matrix[row - 1];
      if (!currentRow || !previousRow) {
        continue;
      }
      const substitution = left[row - 1] === right[column - 1] ? 0 : 1;
      currentRow[column] = Math.min(
        (previousRow[column] ?? 0) + 1,
        (currentRow[column - 1] ?? 0) + 1,
        (previousRow[column - 1] ?? 0) + substitution,
      );
    }
  }
  return matrix[left.length]?.[right.length] ?? Math.max(left.length, right.length);
}
