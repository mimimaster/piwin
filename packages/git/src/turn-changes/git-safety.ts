/**
 * Git index checks before an undo/redo writes the working tree.
 *
 * Undo only rewrites working-tree files; it never touches the index or HEAD.
 * A path with staged content (or an unmerged conflict) would end up with the
 * index and the working tree telling different stories, so such paths refuse
 * the operation instead. HEAD moving on its own (a commit in between) is not a
 * reason to refuse: the per-file content hashes already guard the files.
 */
import { runGitCommand } from '../git-command-runner.js';

/** Pathspecs per git invocation, well below any argv limit. */
const PATHSPEC_CHUNK = 200;

/**
 * Of `relativePaths` (relative to `workspaceRoot`), the ones with staged or
 * unmerged index entries. Empty outside a Git work tree, and when Git itself
 * cannot answer (the content-hash check still protects the files).
 */
export async function findIndexBlockedPaths(
  workspaceRoot: string,
  relativePaths: readonly string[],
): Promise<string[]> {
  if (relativePaths.length === 0 || !(await isInsideWorkTree(workspaceRoot))) return [];
  const blocked = new Set<string>();
  try {
    for (let start = 0; start < relativePaths.length; start += PATHSPEC_CHUNK) {
      const chunk = relativePaths.slice(start, start + PATHSPEC_CHUNK);
      const pathspecs = chunk.map((path) => `:(literal)${path}`);
      const staged = await runGitCommand({
        cwd: workspaceRoot,
        args: ['diff', '--cached', '--name-only', '--relative', '-z', '--', ...pathspecs],
      });
      for (const path of splitNul(staged.stdout)) blocked.add(path);
      // Unmerged entries (stage 1–3); `ls-files` paths are relative to cwd.
      const unmerged = await runGitCommand({
        cwd: workspaceRoot,
        args: ['ls-files', '--unmerged', '-z', '--', ...pathspecs],
      });
      for (const record of splitNul(unmerged.stdout)) {
        const tab = record.indexOf('\t');
        if (tab >= 0) blocked.add(record.slice(tab + 1));
      }
    }
  } catch (error) {
    console.warn('[turn-changes] git index check failed; relying on content hashes', error);
    return [];
  }
  return relativePaths.filter((path) => blocked.has(path));
}

async function isInsideWorkTree(cwd: string): Promise<boolean> {
  try {
    const result = await runGitCommand({
      cwd,
      args: ['rev-parse', '--is-inside-work-tree'],
      allowFailure: true,
    });
    return result.exitCode === 0 && result.stdout.trim() === 'true';
  } catch {
    // No git binary / not a directory git can open: nothing to check.
    return false;
  }
}

function splitNul(output: string): string[] {
  return output.split('\0').filter((entry) => entry.length > 0);
}
