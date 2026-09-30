import { projectDisplayName } from './project-display-name';
import type { ProjectWorktreeListing } from '@piwin/contracts';

export type SidebarProjectRef = {
  path: string;
  displayName?: string;
  gitRepositoryId?: string;
  isPrimaryWorktree?: boolean;
  currentBranch?: string;
  /** Git checkout root; same for a subdirectory of one worktree. */
  gitRootPath?: string;
  /** Path is the checkout root or a symlink to it (not a subdirectory of it). */
  isCheckoutRoot?: boolean;
  workspaceAvailability?: 'missing';
  /** Path-nested remembered projects that live inside this folder. */
  nested?: SidebarProjectRef[];
  /** Other remembered paths that are the same directory (symlink alias); their sessions show here. */
  aliasPaths?: string[];
};

export type SidebarProjectCluster =
  | { kind: 'solo'; project: SidebarProjectRef }
  | {
      kind: 'group';
      gitRepositoryId: string;
      title: string;
      members: SidebarProjectRef[];
      unregistered?: ProjectWorktreeListing[];
    };

export function normalizeSidebarProjectPath(projectPath: string): string {
  return projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** True when `innerPath` is a subdirectory of `outerPath`. */
export function isNestedProjectPath(innerPath: string, outerPath: string): boolean {
  const inner = normalizeSidebarProjectPath(innerPath);
  const outer = normalizeSidebarProjectPath(outerPath);
  return inner !== outer && inner.startsWith(`${outer}/`);
}

function gitCheckoutRoot(project: SidebarProjectRef): string | null {
  return project.gitRootPath ? normalizeSidebarProjectPath(project.gitRootPath) : null;
}

/**
 * True when `inner` is a subdirectory of the same git checkout as `outer`.
 * `outer.path` may be a symlink alias of the checkout root, so string prefixes
 * of the remembered paths are not enough.
 */
export function isSameCheckoutSubdirectory(
  inner: SidebarProjectRef,
  outer: SidebarProjectRef,
): boolean {
  const innerRoot = gitCheckoutRoot(inner);
  const outerRoot = gitCheckoutRoot(outer);
  if (!innerRoot || !outerRoot || innerRoot !== outerRoot) {
    return false;
  }
  const innerUnderRoot = isNestedProjectPath(inner.path, innerRoot);
  const outerUnderRoot = isNestedProjectPath(outer.path, outerRoot);
  return innerUnderRoot && !outerUnderRoot;
}

function isNestedSidebarProject(inner: SidebarProjectRef, outer: SidebarProjectRef): boolean {
  return (
    [outer.path, ...(outer.aliasPaths ?? [])].some((outerPath) =>
      isNestedProjectPath(inner.path, outerPath),
    ) || isSameCheckoutSubdirectory(inner, outer)
  );
}

/** Every remembered path a folder stands for: its own plus folded aliases. */
export function sidebarProjectAllPaths(project: SidebarProjectRef): string[] {
  return [project.path, ...(project.aliasPaths ?? [])];
}

/**
 * Fold records that are the same directory under two names (for example a
 * symlink on another volume and its real path). They share `gitRootPath` and
 * are both checkout roots; a subdirectory project is not one, so it never
 * folds. The record sitting at the git root itself stays as the folder
 * because it does not depend on the aliasing volume being mounted.
 */
export function foldCheckoutAliasProjects(
  projects: readonly SidebarProjectRef[],
): SidebarProjectRef[] {
  const aliasGroups = new Map<string, SidebarProjectRef[]>();
  for (const project of projects) {
    const root = project.isCheckoutRoot === true ? gitCheckoutRoot(project) : null;
    if (root === null) {
      continue;
    }
    const group = aliasGroups.get(root) ?? [];
    group.push(project);
    aliasGroups.set(root, group);
  }

  const primaryByRoot = new Map<string, SidebarProjectRef>();
  for (const [root, group] of aliasGroups) {
    if (group.length < 2) {
      continue;
    }
    const primary =
      group.find((member) => normalizeSidebarProjectPath(member.path) === root) ?? group[0];
    if (primary) {
      primaryByRoot.set(root, primary);
    }
  }
  if (primaryByRoot.size === 0) {
    return [...projects];
  }

  const folded: SidebarProjectRef[] = [];
  const emitted = new Set<string>();
  for (const project of projects) {
    const root = project.isCheckoutRoot === true ? gitCheckoutRoot(project) : null;
    const primary = root === null ? undefined : primaryByRoot.get(root);
    if (!root || !primary) {
      folded.push(project);
      continue;
    }
    if (emitted.has(root)) {
      continue;
    }
    emitted.add(root);
    const aliasPaths = (aliasGroups.get(root) ?? [])
      .filter((member) => member.path !== primary.path)
      .map((member) => member.path);
    folded.push({ ...primary, aliasPaths });
  }
  return folded;
}

/** Remembered paths folded under `projectPath`'s sidebar folder (empty for an ordinary project). */
export function checkoutAliasPaths(
  projects: readonly SidebarProjectRef[],
  projectPath: string,
): string[] {
  return foldCheckoutAliasProjects(projects).find((project) => project.path === projectPath)
    ?.aliasPaths ?? [];
}

function longestContainingParent(
  project: SidebarProjectRef,
  projects: readonly SidebarProjectRef[],
): SidebarProjectRef | null {
  let best: SidebarProjectRef | null = null;
  let bestLength = -1;
  for (const candidate of projects) {
    if (candidate.path === project.path) {
      continue;
    }
    if (!isNestedSidebarProject(project, candidate)) {
      continue;
    }
    const length = normalizeSidebarProjectPath(candidate.path).length;
    if (length > bestLength) {
      best = candidate;
      bestLength = length;
    }
  }
  return best;
}

/**
 * Fold remembered projects that sit inside another remembered path.
 * `/piwin` + `/piwin/apps` is a nested workspace, not two worktrees.
 */
export function attachNestedProjects(
  projects: readonly SidebarProjectRef[],
): SidebarProjectRef[] {
  const nestedPaths = new Set<string>();
  const childrenByParent = new Map<string, SidebarProjectRef[]>();
  for (const project of projects) {
    const parent = longestContainingParent(project, projects);
    if (!parent) {
      continue;
    }
    nestedPaths.add(project.path);
    const siblings = childrenByParent.get(parent.path) ?? [];
    siblings.push(project);
    childrenByParent.set(parent.path, siblings);
  }

  const withChildren = (project: SidebarProjectRef): SidebarProjectRef => {
    const children = childrenByParent.get(project.path);
    if (!children || children.length === 0) {
      if (project.nested === undefined) {
        return project;
      }
      const { nested: _ignored, ...rest } = project;
      return rest;
    }
    return { ...project, nested: children.map(withChildren) };
  };

  return projects.filter((project) => !nestedPaths.has(project.path)).map(withChildren);
}

/**
 * Cluster remembered projects for the sidebar.
 * Same `gitRepositoryId` with 2+ members becomes one group; a lone worktree
 * stays a flat folder so ordinary projects do not gain an extra indent.
 * Nested paths are attached under the containing project first so a repo
 * subdirectory cannot steal the worktree-group title.
 */
export function clusterProjectsByRepository(
  projects: readonly SidebarProjectRef[],
  worktrees: readonly ProjectWorktreeListing[] = [],
): SidebarProjectCluster[] {
  const rooted = attachNestedProjects(foldCheckoutAliasProjects(projects));
  const membersByRepo = new Map<string, SidebarProjectRef[]>();
  for (const project of rooted) {
    const repoId = project.gitRepositoryId;
    if (!repoId) {
      continue;
    }
    const members = membersByRepo.get(repoId) ?? [];
    members.push(project);
    membersByRepo.set(repoId, members);
  }

  const emitted = new Set<string>();
  const clusters: SidebarProjectCluster[] = [];
  const registeredCheckouts = new Set(
    rooted.map((project) => checkoutKey(project)),
  );
  for (const project of rooted) {
    if (emitted.has(project.path)) {
      continue;
    }
    const repoId = project.gitRepositoryId;
    const members = repoId ? (membersByRepo.get(repoId) ?? [project]) : [project];
    const unregistered = repoId
      ? worktrees.filter((worktree) => worktree.gitRepositoryId === repoId &&
          !registeredCheckouts.has(normalizeSidebarProjectPath(worktree.path)))
      : [];
    if (!repoId || !hasDistinctGitCheckouts(members, unregistered)) {
      clusters.push({ kind: 'solo', project });
      emitted.add(project.path);
      continue;
    }
    const ordered = orderRepoMembers(members);
    const primaryProject = ordered.find((item) => item.isPrimaryWorktree === true);
    const primaryWorktree = unregistered.find((item) => item.isPrimary);
    const titleSource = primaryProject ?? ordered[0];
    clusters.push({
      kind: 'group',
      gitRepositoryId: repoId,
      title: primaryProject?.displayName?.trim() ||
        projectDisplayName(primaryProject?.path ?? primaryWorktree?.path ?? titleSource?.path ?? ''),
      members: ordered,
      ...(unregistered.length > 0 ? { unregistered } : {}),
    });
    for (const member of members) {
      emitted.add(member.path);
    }
  }
  return clusters;
}

function orderRepoMembers(members: readonly SidebarProjectRef[]): SidebarProjectRef[] {
  const primary = members.filter((item) => item.isPrimaryWorktree === true);
  const linked = members.filter((item) => item.isPrimaryWorktree !== true);
  return [...primary, ...linked];
}

function checkoutKey(project: SidebarProjectRef): string {
  return gitCheckoutRoot(project) ?? normalizeSidebarProjectPath(project.path);
}

/** Linked worktrees have different checkout roots; a subdirectory does not. */
function hasDistinctGitCheckouts(
  members: readonly SidebarProjectRef[],
  unregistered: readonly ProjectWorktreeListing[],
): boolean {
  const keys = new Set([
    ...members.map((member) => checkoutKey(member)),
    ...unregistered.map((worktree) => normalizeSidebarProjectPath(worktree.path)),
  ]);
  return keys.size >= 2;
}
