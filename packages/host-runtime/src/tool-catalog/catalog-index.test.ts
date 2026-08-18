import { describe, expect, it } from 'vitest';
import type { HostToolRegistration, SessionToolFamily } from '@piwin/contracts';
import {
  applyCatalogSearchBudget,
  CATALOG_SEARCH_OUTPUT_MAX_CHARS,
  isMcpCatalogTarget,
  rankCatalogHits,
  searchHostCatalog,
  suggestCatalogIds,
  type CatalogSearchHit,
} from './catalog-index.js';

function hostTool(
  name: string,
  family: SessionToolFamily,
  description: string,
): HostToolRegistration {
  return {
    descriptor: {
      name,
      description,
      parameters: {
        type: 'object',
        properties: {
          notes: { type: 'string', description: 'Source notes for this action' },
        },
      },
    },
    family,
    permissionSpec: {
      action: 'filesystem:read',
      risk: 'unknown',
      rememberable: false,
      readOnly: true,
    },
    async execute() {
      return { ok: true, output: name };
    },
  };
}

function hit(
  id: string,
  overrides: Partial<CatalogSearchHit> = {},
): CatalogSearchHit {
  return {
    id,
    source: 'host',
    description: id,
    exact: false,
    prefix: false,
    keywordHits: 0,
    ...overrides,
  };
}

describe('catalog-index', () => {
  const targets = [
    hostTool('image_gen', 'image-generation', 'Generate an image from a prompt'),
    hostTool('flashcard_create', 'flashcards-write', 'Create flashcards from study notes'),
    hostTool('process_start', 'process', 'Start a background process'),
  ];

  it('ranks exact name matches ahead of keyword hits', () => {
    const ranked = searchHostCatalog(targets, 'image_gen');
    expect(ranked[0]?.id).toBe('image_gen');
    expect(ranked[0]?.exact).toBe(true);
  });

  it('matches parameter descriptions as keywords', () => {
    const ranked = searchHostCatalog(targets, 'study notes');
    expect(ranked.map((entry) => entry.id)).toContain('flashcard_create');
  });

  it('returns every host target for an empty query, sorted by id', () => {
    const ranked = searchHostCatalog(targets, '   ');
    expect(ranked.map((entry) => entry.id)).toEqual([
      'flashcard_create',
      'image_gen',
      'process_start',
    ]);
  });

  it('does not match unrelated queries', () => {
    expect(searchHostCatalog(targets, 'calendar invite')).toEqual([]);
  });

  it('orders exact > prefix > keywordHits > id', () => {
    const ranked = rankCatalogHits([
      hit('zeta', { keywordHits: 5 }),
      hit('alpha_tool', { prefix: true }),
      hit('alpha', { exact: true }),
      hit('beta', { keywordHits: 5 }),
    ]);
    expect(ranked.map((entry) => entry.id)).toEqual(['alpha', 'alpha_tool', 'beta', 'zeta']);
  });

  it('suggests nearby ids for typos', () => {
    expect(suggestCatalogIds(['image_gen', 'video_gen', 'flashcard_create'], 'image_gn')).toEqual([
      'image_gen',
    ]);
  });

  it('identifies MCP selectors without treating Host names as MCP', () => {
    expect(isMcpCatalogTarget('docs.search')).toBe(true);
    expect(isMcpCatalogTarget('image_gen')).toBe(false);
    expect(isMcpCatalogTarget('./relative')).toBe(false);
  });

  it('drops schemas then hits when the search payload exceeds the budget', () => {
    const oversized: CatalogSearchHit[] = Array.from({ length: 40 }, (_, index) =>
      hit(`tool_${index}`, {
        description: 'd'.repeat(400),
        schema: {
          name: `tool_${index}`,
          description: 'd'.repeat(400),
          parameters: { type: 'object', properties: { body: { type: 'string', description: 'x'.repeat(200) } } },
        },
      }),
    );
    const budgeted = applyCatalogSearchBudget(oversized);
    expect(JSON.stringify({ tools: budgeted.tools }).length).toBeLessThanOrEqual(
      CATALOG_SEARCH_OUTPUT_MAX_CHARS,
    );
    expect(budgeted.tools.some((entry) => entry.schema !== undefined) || budgeted.truncated).toBe(
      true,
    );
  });
});
