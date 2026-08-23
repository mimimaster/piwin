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

export type LocalFileActionsContextValue = {
  saveAs: (absolutePath: string) => Promise<SaveLocalFileAsResult>;
};

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
    };
  }, [props.request]);

  return (
    <LocalFileActionsContext.Provider value={value}>{props.children}</LocalFileActionsContext.Provider>
  );
}
