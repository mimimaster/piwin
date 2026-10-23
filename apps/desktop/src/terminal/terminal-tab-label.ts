/**
 * Tab label for a terminal session.
 *
 * A shell that reports its window title (OSC 0/2) names its own tab; the
 * common `user@host:path` prompt title is cut down to the directory so the
 * label still fits a tab. A shell that reports nothing keeps `zshN`.
 */

const USER_HOST_PATH = /^[^@\s]+@[^:\s]+:\s*(.+)$/;

export function terminalTabLabel(title: string | undefined, fallback: string): string {
  const trimmed = title?.trim() ?? '';
  if (!trimmed) return fallback;
  const path = USER_HOST_PATH.exec(trimmed)?.[1]?.trim() ?? trimmed;
  if (!/^[~/]/.test(path) || /\s/.test(path)) return path;
  const withoutTrailingSlash = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const leaf = withoutTrailingSlash.slice(withoutTrailingSlash.lastIndexOf('/') + 1);
  return leaf || withoutTrailingSlash;
}
