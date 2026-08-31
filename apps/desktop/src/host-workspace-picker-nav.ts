import type { HostDirEntry, HostListDirData } from '@piwin/contracts';

export const HOST_PICKER_FAVORITES = [
  'Desktop',
  'Documents',
  'Downloads',
  'Applications',
  'Developer',
] as const;

export type HostPickerSidebarItem = {
  name: string;
  path: string;
};

export function favoritePathsFromListing(listing: HostListDirData): HostPickerSidebarItem[] {
  return HOST_PICKER_FAVORITES.flatMap((name) => {
    const entry = listing.entries.find((item) => item.name === name && item.kind === 'directory');
    return entry ? [{ name: entry.name, path: entry.path }] : [];
  });
}

export function replaceColumnsAfter(
  columns: HostListDirData[],
  columnIndex: number,
  next: HostListDirData,
): HostListDirData[] {
  return [...columns.slice(0, columnIndex + 1), next];
}

export function directoryPathForOpen(
  columns: HostListDirData[],
  selectedPath: string | undefined,
): string {
  if (selectedPath) {
    for (const column of columns) {
      const entry = column.entries.find((item) => item.path === selectedPath);
      if (entry?.kind === 'directory') {
        return entry.path;
      }
      if (column.path === selectedPath) {
        return column.path;
      }
    }
  }
  const last = columns[columns.length - 1];
  return last?.path ?? '';
}

export function selectedFilePath(
  columns: HostListDirData[],
  selectedPath: string | undefined,
): string {
  if (!selectedPath) {
    return '';
  }
  for (const column of columns) {
    const entry = column.entries.find((item) => item.path === selectedPath);
    if (entry?.kind === 'file') {
      return entry.path;
    }
  }
  return '';
}

export function selectedEntryIsFile(
  columns: HostListDirData[],
  selectedPath: string | undefined,
): boolean {
  return selectedFilePath(columns, selectedPath).length > 0;
}

export function filterColumnEntries(entries: HostDirEntry[], query: string): HostDirEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return entries;
  }
  return entries.filter((entry) => entry.name.toLowerCase().includes(needle));
}

export function sortPickerEntries(entries: HostDirEntry[]): HostDirEntry[] {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'directory' ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}
