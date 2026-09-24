/**
 * Shared writer-slot identity.
 *
 * Writes are serialized per project, so the Host keeps one reusable checkout
 * per project instead of one per task. That copy is *shared*: it is reset in
 * place between tasks and any task may be using it at any moment. Two places
 * have to agree on which paths are slots — the Host, which owns the pool, and
 * the Desktop, which must not offer to open a slot as if it were a task's own
 * working tree — so the predicate lives here rather than in either side.
 */

/** The only slot a project needs today; the namespace allows more later. */
export const DEFAULT_WRITER_SLOT_ID = 'slot-0';

const SLOT_NAME_PATTERN = /^slot-[0-9]+$/;
export const WRITER_SLOT_BRANCH_PREFIX = 'piwin/subagent/slot-';

/** Folder name of a writer slot (the last path segment). */
export function isWriterSlotName(name: string): boolean {
  return SLOT_NAME_PATTERN.test(name);
}

export function isWriterSlotBranch(branch: string | null | undefined): boolean {
  return typeof branch === 'string' && branch.startsWith(WRITER_SLOT_BRANCH_PREFIX);
}

/** Last path segment, tolerating either separator and trailing separators. */
export function worktreeFolderName(worktreePath: string): string {
  const segments = worktreePath.replace(/[\\/]+$/, '').split(/[\\/]/);
  return segments[segments.length - 1] ?? worktreePath;
}

/**
 * True when a worktree path is the shared writer slot rather than a copy that
 * belongs to one task. Callers must not treat a slot as task-private: it can be
 * reset or rebuilt under them at any time.
 */
export function isWriterSlotWorktreePath(worktreePath: string): boolean {
  return isWriterSlotName(worktreeFolderName(worktreePath));
}
