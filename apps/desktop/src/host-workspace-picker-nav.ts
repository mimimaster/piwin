import type { HostDirEntry, HostListDirData } from '@piwin/contracts';

export const HOST_PICKER_FAVORITES = [
  'Desktop',
  'Documents',
  'Downloads',
  'Applications',
  'Developer',
] as const;

export const HOST_PICKER_COLUMN_WIDTH = 200;
export const HOST_PICKER_COLUMN_MIN = 128;
export const HOST_PICKER_COLUMN_MAX = 560;
export const HOST_PICKER_SIDEBAR_WIDTH = 148;
export const HOST_PICKER_SIDEBAR_MIN = 108;
export const HOST_PICKER_SIDEBAR_MAX = 280;
export const HOST_PICKER_DIALOG_MIN_WIDTH = 520;
export const HOST_PICKER_DIALOG_MIN_HEIGHT = 300;
export const HOST_PICKER_MAX_ANCESTOR_COLUMNS = 8;

export function clampPickerMeasure(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Slash-normalize Host paths so POSIX and Windows listings compare the same way. */
export function normalizeHostPickerPath(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return '';
  }
  const slash = trimmed.replace(/\\/g, '/');
  if (slash === '/') {
    return '/';
  }
  return slash.replace(/\/+$/, '');
}

export function hostPathContains(parentPath: string, childPath: string): boolean {
  const parent = normalizeHostPickerPath(parentPath);
  const child = normalizeHostPickerPath(childPath);
  if (parent.length === 0 || child.length === 0) {
    return false;
  }
  if (parent === child) {
    return true;
  }
  if (parent === '/') {
    return child.startsWith('/');
  }
  return child.startsWith(`${parent}/`);
}

export function shouldListParentColumn(listing: HostListDirData): boolean {
  const parentPath = listing.parentPath;
  if (!parentPath) {
    return false;
  }
  if (!hostPathContains(listing.homePath, listing.path)) {
    return false;
  }
  if (normalizeHostPickerPath(listing.path) === normalizeHostPickerPath(listing.homePath)) {
    return false;
  }
  return hostPathContains(listing.homePath, parentPath);
}

export function pickerRowSelected(entry: HostDirEntry, focusPath: string): boolean {
  if (entry.path === focusPath) {
    return true;
  }
  if (entry.kind !== 'directory') {
    return false;
  }
  return hostPathContains(entry.path, focusPath);
}

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
