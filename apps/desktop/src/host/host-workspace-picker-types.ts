import type { HostCreateEntryInput, HostDirEntry, HostListDirData } from '@piwin/contracts';

export type HostWorkspacePickerProps = {
  locale: 'zh-CN' | 'en';
  currentPath: string;
  onCurrentPathChange: (path: string) => void;
  listDirectory: (path?: string, includeHidden?: boolean) => Promise<HostListDirData>;
  createEntry?: (input: HostCreateEntryInput) => Promise<HostDirEntry>;
  recents?: readonly string[];
  onConfirm: (path: string) => void;
  onCancel: () => void;
  /** Directory = open a folder (workspace). File = choose an executable/script. */
  mode?: 'directory' | 'file';
};
