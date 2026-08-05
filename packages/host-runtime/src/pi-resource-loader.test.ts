import { describe, expect, it } from 'vitest';
import type { ResourceCatalogEntry } from '@piwin/contracts';
import { buildResourceShadowDiagnostics } from './pi-resource-loader.js';

function resource(
  overrides: Partial<ResourceCatalogEntry> & Pick<ResourceCatalogEntry, 'resourceId' | 'kind'>,
): ResourceCatalogEntry {
  return {
    name: overrides.resourceId,
    path: `/resources/${overrides.resourceId}-${overrides.source ?? 'user'}`,
    source: 'user',
    ...overrides,
  };
}

describe('buildResourceShadowDiagnostics', () => {
  it('reports precedence shadowing within one family', () => {
    const diagnostics = buildResourceShadowDiagnostics([
      resource({
        resourceId: 'shared',
        kind: 'skill',
        source: 'project',
        path: '/project/SKILL.md',
      }),
      resource({
        resourceId: 'shared',
        kind: 'skill',
        source: 'bundled',
        path: '/bundled/SKILL.md',
      }),
    ]);

    expect(diagnostics).toEqual([
      {
        kind: 'shadowed',
        resourceKind: 'skill',
        resourceId: 'shared',
        winnerPath: '/bundled/SKILL.md',
        winnerSource: 'bundled',
        loserPath: '/project/SKILL.md',
        loserSource: 'project',
      },
    ]);
  });

  it('keeps same IDs independent across resource families', () => {
    const diagnostics = buildResourceShadowDiagnostics([
      resource({ resourceId: 'shared', kind: 'skill', source: 'user' }),
      resource({ resourceId: 'shared', kind: 'prompt', source: 'user' }),
    ]);

    expect(diagnostics).toEqual([]);
  });

  it('reports duplicate candidates from the same source', () => {
    const diagnostics = buildResourceShadowDiagnostics([
      resource({ resourceId: 'shared', kind: 'extension', path: '/one.ts' }),
      resource({ resourceId: 'shared', kind: 'extension', path: '/two.ts' }),
    ]);

    expect(diagnostics[0]).toMatchObject({
      kind: 'duplicate-id',
      resourceKind: 'extension',
      resourceId: 'shared',
      winnerPath: '/one.ts',
      loserPath: '/two.ts',
    });
  });
});
