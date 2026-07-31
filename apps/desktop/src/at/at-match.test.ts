import { describe, expect, it } from 'vitest';
import { buildAtCatalog } from './at-catalog';
import { filterAtItems, groupAtItems } from './at-match';

describe('at-match', () => {
  it('filters catalog by query', () => {
    const catalog = buildAtCatalog({
      mcpServers: [{ id: 'search', name: 'WebSearch' }],
      recentFiles: ['src/App.tsx', 'package.json'],
    });

    const matches = filterAtItems(catalog, 'git');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some((item) => item.label.includes('git'))).toBe(true);
  });

  it('groups items into sections', () => {
    const catalog = buildAtCatalog({
      mcpServers: [{ id: 'search', name: 'WebSearch' }],
      recentFiles: ['src/App.tsx'],
    });

    const groups = groupAtItems(catalog);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.some((g) => g.groupLabel === 'System Context')).toBe(true);
  });
});
