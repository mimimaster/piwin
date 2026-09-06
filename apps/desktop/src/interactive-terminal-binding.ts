/**
 * Desktop interactive terminal is a local Tauri capability (ADR 0013).
 * Remote Host attachment must not invent a second gate: opaque project ids
 * are not filesystem paths, and must never be used as a PTY cwd.
 */
import { isOpaqueRemoteProjectId } from './remote-session-hydrate.js';

export function isDesktopTerminalFilesystemPath(
  value: string | null | undefined,
): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  const trimmed = value.trim();
  if (!trimmed || isOpaqueRemoteProjectId(trimmed)) {
    return false;
  }
  if (trimmed === '~' || trimmed.startsWith('~/') || trimmed.startsWith('/')) {
    return true;
  }
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return true;
  }
  return trimmed.startsWith('\\\\');
}

export function resolveInteractiveTerminalProjectPath(
  projectPath: string | null | undefined,
): string | null {
  if (!isDesktopTerminalFilesystemPath(projectPath)) {
    return null;
  }
  return projectPath?.trim() ?? null;
}

export function resolveInteractiveTerminalCwd(input: {
  preferredCwd: string;
  projectPath: string | null | undefined;
}): string {
  const candidates = [input.preferredCwd, input.projectPath ?? ''];
  for (const candidate of candidates) {
    if (isDesktopTerminalFilesystemPath(candidate)) {
      return candidate.trim();
    }
  }
  return '';
}
