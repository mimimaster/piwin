import { describe, expect, it } from 'vitest';
import type { HostListDirData } from '@piwin/contracts';
import {
  clampPickerMeasure,
  directoryPathForOpen,
  favoritePathsFromListing,
  filterColumnEntries,
  HOST_PICKER_COLUMN_MAX,
  HOST_PICKER_COLUMN_MIN,
  hostPathContains,
  pickerRowSelected,
  replaceColumnsAfter,
  selectedEntryIsFile,
  shouldListParentColumn,
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

  it('treats a nested folder as on the current path', () => {
    expect(hostPathContains('/Users/host', '/Users/host/Developer/piwin')).toBe(true);
    expect(hostPathContains('/Users/host/Developer', '/Users/host')).toBe(false);
    expect(
      pickerRowSelected(
        { name: 'Developer', kind: 'directory', path: '/Users/host/Developer' },
        '/Users/host/Developer/piwin',
      ),
    ).toBe(true);
    expect(
      pickerRowSelected(
        { name: 'notes.txt', kind: 'file', path: '/Users/host/notes.txt' },
        '/Users/host/Developer',
      ),
    ).toBe(false);
  });

  it('walks parent columns from home, not past it', () => {
    expect(shouldListParentColumn(developer)).toBe(true);
    expect(shouldListParentColumn(home)).toBe(false);
    expect(
      shouldListParentColumn({
        path: '/tmp/scratch',
        parentPath: '/tmp',
        homePath: '/Users/host',
        entries: [],
      }),
    ).toBe(false);
  });

  it('clamps column drag within the picker range', () => {
    expect(clampPickerMeasure(80, HOST_PICKER_COLUMN_MIN, HOST_PICKER_COLUMN_MAX)).toBe(
      HOST_PICKER_COLUMN_MIN,
    );
    expect(clampPickerMeasure(900, HOST_PICKER_COLUMN_MIN, HOST_PICKER_COLUMN_MAX)).toBe(
      HOST_PICKER_COLUMN_MAX,
    );
    expect(clampPickerMeasure(220.4, HOST_PICKER_COLUMN_MIN, HOST_PICKER_COLUMN_MAX)).toBe(220);
  });
});
