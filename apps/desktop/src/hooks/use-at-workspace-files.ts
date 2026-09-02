/**
 * Workspace file/folder index for composer `@` completion.
 * Host `project/list-dir` is the only reader of the filesystem.
 */
import { useEffect, useState } from 'react';
import type { ProjectListDirData } from '@piwin/contracts';
import { collectWorkspaceFileIndex, type AtWorkspaceEntry } from '../at/at-file-index';
import type { HostClient } from '../host-client';

export function useAtWorkspaceFiles(args: {
  hostClient: HostClient;
  projectPath: string | null;
  projectTrusted: boolean;
}): readonly AtWorkspaceEntry[] {
  const { hostClient, projectPath, projectTrusted } = args;
  const [loaded, setLoaded] = useState<{
    projectPath: string;
    entries: readonly AtWorkspaceEntry[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!projectPath || !projectTrusted || !hostClient.supportsCommand('project/list-dir')) {
      return;
    }
    void collectWorkspaceFileIndex(
      async (relativePath) => {
        const response = await hostClient.request({
          type: 'project/list-dir',
          projectPath,
          ...(relativePath ? { relativePath } : {}),
        });
        if (!response.success) {
          throw new Error(response.error);
        }
        return (response.data as ProjectListDirData).entries ?? [];
      },
      { isCancelled: () => cancelled },
    )
      .then((next) => {
        if (!cancelled) setLoaded({ projectPath, entries: next });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ projectPath, entries: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [hostClient, projectPath, projectTrusted]);

  if (!projectPath || !projectTrusted || loaded?.projectPath !== projectPath) {
    return [];
  }
  return loaded.entries;
}
