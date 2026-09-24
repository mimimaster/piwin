/**
 * In-memory per-session permission allowlist (ADR 0024 §4).
 *
 * Stores bash commands (exact match) and file-write paths (path-safe prefix)
 * approved with `rememberScope: 'session'`. Lives only in the host process —
 * nothing is persisted to disk. Cleared when the session ends.
 */

/** Check whether a bash command matches any entry in an exact-match allowlist. */
export function commandInSessionAllowlist(command: string, allowlist: ReadonlySet<string>): boolean {
  return allowlist.has(command.trim());
}

/** Check whether a path matches any entry in a path-safe-prefix allowlist. */
export function pathInSessionAllowlist(path: string, allowlist: ReadonlySet<string>): boolean {
  const normalized = path.trim();
  if (!normalized) return false;
  for (const entry of allowlist) {
    if (normalized === entry || normalized.startsWith(entry + '/')) {
      return true;
    }
  }
  return false;
}

/**
 * Workspace boundary grants are either a directory (including descendants)
 * or exact file paths. Paths are canonical (real paths).
 */
export type SessionWorkspaceGrant =
  | { directory: string }
  | { filePaths: readonly string[] };

/**
 * Mutable per-session allowlist. Entries are added when the user picks
 * "Allow for session" on a permission prompt.
 */
export class SessionAllowlist {
  private readonly bashCommands = new Set<string>();
  private readonly filePaths = new Set<string>();
  private readonly workspaceDirectories = new Set<string>();

  /** Record a bash command approved for this session (exact match). */
  addBashCommand(command: string): void {
    const trimmed = command.trim();
    if (trimmed) {
      this.bashCommands.add(trimmed);
    }
  }

  /** Record a file-write path approved for this session (path-safe prefix). */
  addFilePath(path: string): void {
    const trimmed = path.trim();
    if (trimmed) {
      this.filePaths.add(trimmed);
    }
  }

  /** Record a directory the user let this session operate in. */
  addWorkspaceDirectory(directory: string): void {
    const trimmed = directory.trim().replace(/\/+$/, '');
    if (trimmed) {
      this.workspaceDirectories.add(trimmed);
    }
  }

  /** True if `path` is inside a directory granted for this session. */
  hasWorkspacePath(path: string): boolean {
    return pathInSessionAllowlist(path, this.workspaceDirectories);
  }

  /** True if the command was approved for this session (exact match). */
  hasBashCommand(command: string): boolean {
    return commandInSessionAllowlist(command, this.bashCommands);
  }

  /** True if the path was approved for this session (path-safe prefix). */
  hasFilePath(path: string): boolean {
    return pathInSessionAllowlist(path, this.filePaths);
  }

  /** Number of entries (bash + file + directory). Useful for debugging. */
  get size(): number {
    return this.bashCommands.size + this.filePaths.size + this.workspaceDirectories.size;
  }

  /** Clear all entries (called on session end). */
  clear(): void {
    this.bashCommands.clear();
    this.filePaths.clear();
    this.workspaceDirectories.clear();
  }
}
