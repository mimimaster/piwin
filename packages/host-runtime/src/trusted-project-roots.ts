/**
 * Trusted roots for managed process / job cwd validation.
 *
 * The built-in No Repo workspace is Host-owned and deliberately absent from
 * `projects.json`, but the No Repo spec keeps it always trusted. Without it in
 * this list every shell call inside No Repo dies as "cwd is outside trusted
 * projects" even though the capability layer already trusts that path.
 */
import { resolve } from 'node:path';
import { listProjects } from '@piwin/project';
import { getPiwinGeneralWorkspacePath, getPiwinProjectsPath, getPiwinRoot } from './paths.js';

export async function listTrustedProjectRoots(piwinRoot?: string): Promise<string[]> {
  const rootDir = getPiwinRoot(piwinRoot);
  const projects = await listProjects(getPiwinProjectsPath(rootDir));
  return [
    getPiwinGeneralWorkspacePath(rootDir),
    ...projects.filter((project) => project.trust === 'trusted').map((project) => project.path),
  ];
}

export type SubagentWorktreeLeaseTrust = {
  /** Set only while a worktree lease is held. Absent for readonly children. */
  worktreePath?: string;
};

/**
 * Dispatching a worktree child is the authorization for that copy.
 * The directory is new, so it is never in `projects.json`, and parent-project
 * trust is not required. The grant is that worktree only, and it disappears
 * when the child context does.
 */
export function trustedWorktreeRoots(
  leases: readonly SubagentWorktreeLeaseTrust[],
  trustedProjectRoots: readonly string[],
): string[] {
  const alreadyTrusted = new Set(trustedProjectRoots.map((root) => resolve(root)));
  const granted: string[] = [];
  const seen = new Set<string>();
  for (const lease of leases) {
    const worktreePath = lease.worktreePath?.trim();
    if (!worktreePath) {
      continue;
    }
    const worktree = resolve(worktreePath);
    if (alreadyTrusted.has(worktree) || seen.has(worktree)) {
      continue;
    }
    seen.add(worktree);
    granted.push(worktree);
  }
  return granted;
}
