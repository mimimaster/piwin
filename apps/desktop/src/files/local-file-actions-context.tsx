/**
 * Provides Host-backed local file export to PathChip (and other surfaces)
 * without prop-drilling through MarkdownView.
 */
import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from 'react';
import type { HostCommand, HostResponse, LocalFileExportData } from '@piwin/contracts';
import {
  saveLocalFileAs,
  type LocalFileBytesReader,
  type SaveLocalFileAsResult,
} from './local-file-actions.js';
import {
  projectSearchQueryForPath,
  resolveProjectFilePath,
  type ProjectFileResolution,
} from './resolve-project-file.js';

/** Which project file a chip path was meant to name. */
export type ProjectFileLookup = { projectPath: string; requestedPath: string };

export type LocalFileActionsContextValue = {
  saveAs: (absolutePath: string) => Promise<SaveLocalFileAsResult>;
  /**
   * `project/find-file` access for the chips this provider feeds. Chip text
   * can be a bare file name while the file lives in a subfolder, and Reveal
   * must not open the wrong folder because of it. Only a unique, complete
   * search answers; the caller decides what an empty answer means.
   */
  resolveProjectFile: (query: ProjectFileLookup) => Promise<ProjectFileResolution>;
};

export function createProjectFileResolver(input: {
  request: (command: HostCommand) => Promise<HostResponse>;
}): LocalFileActionsContextValue['resolveProjectFile'] {
  return async (query) => {
    const root = query.projectPath.trim();
    if (!root) {
      return { kind: 'none' };
    }
    const search = projectSearchQueryForPath(query.requestedPath, root);
    if (!search) {
      return { kind: 'none' };
    }
    return resolveProjectFilePath({
      request: (command) => input.request(command),
      projectPath: root,
      query: search,
    });
  };
}

const LocalFileActionsContext = createContext<LocalFileActionsContextValue | null>(null);

export function useLocalFileActions(): LocalFileActionsContextValue | null {
  return useContext(LocalFileActionsContext);
}

function decodeBase64ToBytes(base64Data: string): Uint8Array {
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index) ?? 0;
  }
  return bytes;
}

export function createHostLocalFileBytesReader(
  request: (command: HostCommand) => Promise<HostResponse>,
): LocalFileBytesReader {
  return async (absolutePath) => {
    const response = await request({
      type: 'preview/export-local-file',
      input: { absolutePath },
    });
    if (!response.success) {
      return null;
    }
    const data = response.data as LocalFileExportData | undefined;
    if (!data || data.status !== 'ready') {
      return null;
    }
    return {
      fileName: data.fileName,
      mimeType: data.mimeType,
      bytes: decodeBase64ToBytes(data.base64Data),
    };
  };
}

export function LocalFileActionsProvider(props: {
  request: (command: HostCommand) => Promise<HostResponse>;
  children: ReactNode;
}): ReactElement {
  const value = useMemo<LocalFileActionsContextValue>(() => {
    const readBytes = createHostLocalFileBytesReader(props.request);
    return {
      saveAs: (absolutePath) => saveLocalFileAs(absolutePath, { readBytes }),
      resolveProjectFile: createProjectFileResolver({ request: props.request }),
    };
  }, [props.request]);

  return (
    <LocalFileActionsContext.Provider value={value}>{props.children}</LocalFileActionsContext.Provider>
  );
}
