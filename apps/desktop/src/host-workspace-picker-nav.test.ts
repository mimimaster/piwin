import { describe, expect, it } from 'vitest';
import type { HostListDirData } from '@piwin/contracts';
import {
  directoryPathForOpen,
  favoritePathsFromListing,
  filterColumnEntries,
  replaceColumnsAfter,
  selectedEntryIsFile,
  sortPickerEntries,
} from './host-workspace-picker-nav.js';

const home: HostListDirData = {
  path: '/Users/host',
  parentPath: '/Users',
  homePath: '/Users/host',
  entries: [
    { name: 'Developer', kind: 'directory', path: '/Users/host/Developer' },
    { name: 'Desktop', kind: 'directory', path: '/Users/host/Desktop' },
    { name: 'notes.txt', kind: 'file', path: '/Users/host/notes.txt' },
  ],
};

const developer: HostListDirData = {
  path: '/Users/host/Developer',
  parentPath: '/Users/host',
  homePath: '/Users/host',
  entries: [{ name: 'piwin', kind: 'directory', path: '/Users/host/Developer/piwin' }],
};

describe('host-workspace-picker-nav', () => {
  it('keeps Desktop/Developer as sidebar favorites', () => {
    expect(favoritePathsFromListing(home).map((item) => item.name)).toEqual([
      'Desktop',
      'Developer',
    ]);
  });

  it('appends a column and drops the ones after the click', () => {
    const columns = replaceColumnsAfter([home, developer], 0, developer);
    expect(columns.map((column) => column.path)).toEqual([
      '/Users/host',
      '/Users/host/Developer',
    ]);
  });

  it('opens the selected directory, not a file', () => {
    expect(directoryPathForOpen([home], '/Users/host/Developer')).toBe('/Users/host/Developer');
    expect(directoryPathForOpen([home], '/Users/host')).toBe('/Users/host');
    expect(selectedEntryIsFile([home], '/Users/host/notes.txt')).toBe(true);
    expect(selectedEntryIsFile([home], '/Users/host/Developer')).toBe(false);
  });

  it('filters and sorts directories ahead of files', () => {
    expect(filterColumnEntries(home.entries, 'dev').map((entry) => entry.name)).toEqual([
      'Developer',
    ]);
    expect(sortPickerEntries(home.entries).map((entry) => entry.name)).toEqual([
      'Desktop',
      'Developer',
      'notes.txt',
    ]);
  });
});
