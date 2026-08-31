/**
 * Open-workspace entry: the Desktop shell uses the OS folder dialog.
 * The in-app Host browser is only for runtimes that cannot call that dialog.
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
}): boolean {
  return !input.desktopShell || input.hostFilesystemRemote === true;
}

export async function pickOrPromptWorkspaceFolder(input: {
  projectPath?: string | null;
  projectInput: string;
  hostHomeDirectory?: string;
  title: string;
  /** Host disk is not this computer; open the Host folder window. */
  hostFilesystemRemote?: boolean;
}): Promise<WorkspaceOpenResult> {
  if (
    shouldPromptHostBrowser({
      desktopShell: isDesktopShellRuntime(),
      ...(input.hostFilesystemRemote === undefined
        ? {}
        : { hostFilesystemRemote: input.hostFilesystemRemote }),
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
