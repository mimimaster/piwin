import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  isWriterSlotBranch,
  isWriterSlotWorktreePath,
  type ProjectRecord,
  type ProjectWorktreeListing,
} from '@piwin/contracts';
import { listGitWorktrees } from '@piwin/git';

const SIDEBAR_WORKTREE_BUDGET_MS = 2_500;

function isInside(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function isMissingProjectPath(projectPath: string): Promise<boolean> {
  try {
    return !(await stat(projectPath)).isDirectory();
  } catch (error) {
    return error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR');
  }
}

/** Read the actual checkout inventory without registering worktrees as projects. */
export async function listProjectSidebarWorktrees(
  projects: readonly ProjectRecord[],
  piwinRoot: string,
): Promise<{ projects: ProjectRecord[]; worktrees: ProjectWorktreeListing[]; pending: boolean }> {
  const productRoot = await realpath(piwinRoot).catch(() => path.resolve(piwinRoot));
  const internalWorktreeRoot = path.join(productRoot, 'worktrees');
  const timedOut = Symbol('worktree-budget');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<typeof timedOut>((resolve) => {
    timer = setTimeout(() => resolve(timedOut), SIDEBAR_WORKTREE_BUDGET_MS);
  });
  let pending = false;
  try {
    // Old shells could register internal copies as projects. Omit those records
    // from the sidebar inventory so a reusable writer slot is never offered as
    // a user workspace, even when it lives under another Host root.
    const visibleProjects = projects.filter((project) =>
      !isInside(internalWorktreeRoot, path.resolve(project.path)) &&
      !isInside(internalWorktreeRoot, path.resolve(project.gitRootPath ?? project.path)) &&
      !isWriterSlotWorktreePath(project.path) &&
      !isWriterSlotWorktreePath(project.gitRootPath ?? project.path) &&
      !isWriterSlotBranch(project.currentBranch),
    );
    const availability = await Promise.all(visibleProjects.map(async (project) => {
      const missing = await Promise.race([isMissingProjectPath(project.path), budget]);
      if (missing === timedOut) {
        pending = true;
        return project;
      }
      return missing ? { ...project, workspaceAvailability: 'missing' as const } : project;
    }));
    const repositories = new Map<string, string>();
    for (const project of availability) {
      if (
        project.workspaceAvailability !== 'missing' &&
        project.gitRepositoryId &&
        project.gitRootPath &&
        !repositories.has(project.gitRepositoryId)
      ) {
        repositories.set(project.gitRepositoryId, project.gitRootPath);
      }
    }
    const inventories = await Promise.all([...repositories].map(async ([gitRepositoryId, rootPath]) => {
        const listed = await Promise.race([
          listGitWorktrees({ rootPath, isRepository: true })
            .then((inventory) => Promise.all(inventory.worktrees.map(async (worktree) => {
              if (!worktree.reachable || isWriterSlotBranch(worktree.branch)) return null;
              const worktreePath = await realpath(worktree.worktreePath)
                .catch(() => worktree.worktreePath);
              if (isInside(internalWorktreeRoot, worktreePath)) return null;
              return {
                gitRepositoryId,
                path: worktreePath,
                branch: worktree.branch,
                isPrimary: worktree.isPrimary,
              } satisfies ProjectWorktreeListing;
            })))
            .then((items) => items.filter((item): item is ProjectWorktreeListing => item !== null))
            .catch(() => []),
          budget,
        ]);
        if (listed === timedOut) {
          pending = true;
          return [];
        }
        return listed;
    }));
    return { projects: availability, worktrees: inventories.flat(), pending };
  } finally {
    clearTimeout(timer);
  }
}
