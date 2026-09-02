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

  it('includes folder mentions from recentFolders', () => {
    const catalog = buildAtCatalog({
      recentFiles: ['src/App.tsx'],
      recentFolders: ['src'],
    });
    const folder = catalog.find((item) => item.kind === 'folder');
    expect(folder).toMatchObject({
      id: 'folder-src',
      name: 'src',
      label: '@src',
      groupLabel: 'Workspace File',
    });
    const matches = filterAtItems(catalog, 'src');
    expect(matches.some((item) => item.kind === 'file' && item.name === 'src/App.tsx')).toBe(true);
    expect(matches.some((item) => item.kind === 'folder' && item.name === 'src')).toBe(true);
  });
});
