/**
 * Open-workspace entry: prefer the in-app Host browser (Inkstone Miller
 * columns) whenever `host/list-dir` is available. The OS folder dialog is
 * only a fallback for desktop shells that cannot list Host directories.
 */
import { isDesktopShellRuntime, pickProjectDirectory } from './pick-project-directory.js';

export type WorkspaceOpenResult =
  | { kind: 'picked'; path: string }
  | { kind: 'dialog' }
  | { kind: 'cancelled' };

export type WorkspacePickerDefaultPathInput = {
  projectPath?: string | null;
  projectInput: string;
  hostHomeDirectory?: string;
};

export function looksLikeFilesystemWorkspacePath(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\\\');
}

export function workspacePickerDefaultPath(input: WorkspacePickerDefaultPathInput): string | undefined {
  const current = input.projectPath?.trim();
  if (current && looksLikeFilesystemWorkspacePath(current)) {
    return current;
  }
  const typed = input.projectInput.trim();
  if (typed && looksLikeFilesystemWorkspacePath(typed)) {
    return typed;
  }
  const home = input.hostHomeDirectory?.trim();
  return home && looksLikeFilesystemWorkspacePath(home) ? home : undefined;
}

export function shouldPromptHostBrowser(input: {
  desktopShell: boolean;
  hostFilesystemRemote?: boolean;
  hostListDirAvailable?: boolean;
}): boolean {
  if (input.hostListDirAvailable === true) {
    return true;
  }
  return !input.desktopShell || input.hostFilesystemRemote === true;
}

export async function pickOrPromptWorkspaceFolder(input: {
  projectPath?: string | null;
  projectInput: string;
  hostHomeDirectory?: string;
  title: string;
  /** Host disk is not this computer; open the Host folder window. */
  hostFilesystemRemote?: boolean;
  /** Host can list directories — use the in-app picker instead of the OS dialog. */
  hostListDirAvailable?: boolean;
}): Promise<WorkspaceOpenResult> {
  if (
    shouldPromptHostBrowser({
      desktopShell: isDesktopShellRuntime(),
      ...(input.hostFilesystemRemote === undefined
        ? {}
        : { hostFilesystemRemote: input.hostFilesystemRemote }),
      ...(input.hostListDirAvailable === undefined
        ? {}
        : { hostListDirAvailable: input.hostListDirAvailable }),
    })
  ) {
    return { kind: 'dialog' };
  }
  const defaultPath = workspacePickerDefaultPath(input);
  const selected = await pickProjectDirectory({
    title: input.title,
    ...(defaultPath ? { defaultPath } : {}),
  });
  if (selected) {
    return { kind: 'picked', path: selected };
  }
  return { kind: 'cancelled' };
}
