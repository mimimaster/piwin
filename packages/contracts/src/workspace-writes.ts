/**
 * Workspace-write classification for the conversation-tree write boundary
 * (ADR 0055 Stage 5). Pure — contracts must not import agent-host.
 *
 * Keep aligned with agent-host `isWriteLikeTool` (`tool-presentation.ts`):
 * the filesystem edit family, which reaches us as `actionVerb: 'Edited'`.
 * Host-reported `changedPaths` always wins over any verb guess.
 *
 * Shell is the hard case: the command can write anything, and the presentation
 * carries no paths. Marking every shell call as a write would fire the switch
 * confirmation on any turn that ran `ls`, which trains users to click through
 * it — so only recognized mutating commands count, and only as an unknown
 * write. A missed write still surfaces in the git snapshot at calibration.
 */

import type { ToolPresentation } from './host.js';
import type { SessionTranscriptMessage } from './session-transcript.js';

export type WorkspaceWrites = {
  files: string[];
  hasUnknownWrites: boolean;
};

/** agent-host emits `Edited`; other backends may phrase it differently. */
const EDIT_VERB = /^(edit|wr[io]te|creat|modif|patch|append|delet|remov)/i;

const SHELL_WRITE_COMMANDS = new Set([
  'chmod',
  'chown',
  'cp',
  'dd',
  'ln',
  'mkdir',
  'mv',
  'patch',
  'rm',
  'rmdir',
  'tee',
  'touch',
  'truncate',
]);

const GIT_WRITE_SUBCOMMANDS = new Set([
  'add',
  'am',
  'apply',
  'checkout',
  'cherry-pick',
  'clean',
  'commit',
  'merge',
  'mv',
  'pull',
  'rebase',
  'reset',
  'restore',
  'revert',
  'rm',
  'stash',
  'switch',
]);

const PACKAGE_MANAGERS = new Set([
  'bun',
  'cargo',
  'gem',
  'go',
  'npm',
  'pip',
  'pip3',
  'pnpm',
  'poetry',
  'yarn',
]);

const PACKAGE_WRITE_SUBCOMMANDS = new Set([
  'add',
  'i',
  'install',
  'link',
  'remove',
  'uninstall',
  'update',
  'upgrade',
]);

export function collectWorkspaceWrites(presentation: ToolPresentation): WorkspaceWrites | null {
  const files = uniquePaths([
    ...(presentation.changedPaths ?? []),
    ...(presentation.targetPaths ?? []),
  ]);
  // Host-authoritative: a tool that reported changed paths wrote them.
  if ((presentation.changedPaths?.length ?? 0) > 0) {
    return { files, hasUnknownWrites: false };
  }
  if (presentation.kind === 'filesystem') {
    return EDIT_VERB.test(presentation.actionVerb ?? '')
      ? { files, hasUnknownWrites: files.length === 0 }
      : null;
  }
  if (presentation.kind === 'shell') {
    return isShellWriteCommand(presentation.command) ? { files, hasUnknownWrites: true } : null;
  }
  return null;
}

/** Conservative: recognized mutating commands only, never "any shell call". */
export function isShellWriteCommand(command: string | undefined): boolean {
  if (command === undefined || command.trim().length === 0) {
    return false;
  }
  // `2>&1` and `>/dev/null` are not workspace writes.
  const normalized = command.replace(/>>?\s*\/dev\/null/g, ' ');
  if (/>>?\s*[^&|\s]/.test(normalized)) {
    return true;
  }
  for (const segment of normalized.split(/\|\||&&|[;|\n]/)) {
    const tokens = segment.trim().split(/\s+/).filter((token) => token.length > 0);
    let index = 0;
    while (
      index < tokens.length &&
      (tokens[index] === 'sudo' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] ?? ''))
    ) {
      index += 1;
    }
    const head = tokens[index];
    if (head === undefined) {
      continue;
    }
    const name = (head.split('/').pop() ?? '').toLowerCase();
    if (SHELL_WRITE_COMMANDS.has(name)) {
      return true;
    }
    const rest = tokens.slice(index + 1).map((token) => token.toLowerCase());
    if ((name === 'sed' || name === 'perl') && rest.some((token) => token.startsWith('-i'))) {
      return true;
    }
    const subcommand = rest.find((token) => !token.startsWith('-'));
    if (subcommand === undefined) {
      continue;
    }
    if (name === 'git' && GIT_WRITE_SUBCOMMANDS.has(subcommand)) {
      return true;
    }
    if (PACKAGE_MANAGERS.has(name) && PACKAGE_WRITE_SUBCOMMANDS.has(subcommand)) {
      return true;
    }
  }
  return false;
}

export function mergeWorkspaceWrites(
  current: WorkspaceWrites | null | undefined,
  incoming: WorkspaceWrites,
): WorkspaceWrites {
  return {
    files: uniquePaths([...(current?.files ?? []), ...incoming.files]),
    hasUnknownWrites: Boolean(current?.hasUnknownWrites || incoming.hasUnknownWrites),
  };
}

/** Prefer persisted metadata; fall back to tool presentations on older rows. */
export function workspaceWritesFromMessage(
  message: SessionTranscriptMessage,
): WorkspaceWrites | null {
  if (message.workspaceWrites) {
    return message.workspaceWrites;
  }
  let merged: WorkspaceWrites | null = null;
  for (const tool of message.tools ?? []) {
    if (tool.presentation === undefined) {
      continue;
    }
    const writes = collectWorkspaceWrites(tool.presentation);
    if (writes) {
      merged = mergeWorkspaceWrites(merged, writes);
    }
  }
  return merged;
}

/** Fold rows into one write set; null when nothing was written. */
export function collectWorkspaceWritesFromMessages(
  messages: readonly SessionTranscriptMessage[],
): WorkspaceWrites | null {
  let merged: WorkspaceWrites | null = null;
  for (const message of messages) {
    const writes = workspaceWritesFromMessage(message);
    if (writes) {
      merged = mergeWorkspaceWrites(merged, writes);
    }
  }
  if (merged === null || (merged.files.length === 0 && !merged.hasUnknownWrites)) {
    return null;
  }
  return merged;
}

/**
 * In-memory variant for clients that already hold the whole tree (the Desktop
 * mock Host). The real Host reads only the abandoned rows out of SQLite.
 */
export function collectOffPathWorkspaceWrites(input: {
  activePath: readonly SessionTranscriptMessage[];
  targetMessageId: string;
  parentById: Readonly<Record<string, string | null | undefined>>;
}): WorkspaceWrites | null {
  const indexById = new Map(input.activePath.map((message, index) => [message.id, index]));
  if (indexById.has(input.targetMessageId)) {
    return null;
  }
  let lcaIndex = -1;
  let cursor: string | null | undefined = input.parentById[input.targetMessageId];
  const seen = new Set<string>();
  while (typeof cursor === 'string' && cursor.length > 0 && !seen.has(cursor)) {
    seen.add(cursor);
    const index = indexById.get(cursor);
    if (index !== undefined) {
      lcaIndex = index;
      break;
    }
    cursor = input.parentById[cursor];
  }
  return collectWorkspaceWritesFromMessages(input.activePath.slice(lcaIndex + 1));
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const path of paths) {
    const trimmed = path.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    files.push(trimmed);
  }
  return files;
}
