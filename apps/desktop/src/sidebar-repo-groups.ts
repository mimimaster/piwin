import { projectDisplayName } from './project-display-name';

export type SidebarProjectRef = {
  path: string;
  displayName?: string;
  gitRepositoryId?: string;
  isPrimaryWorktree?: boolean;
  currentBranch?: string;
  /** Git checkout root; same for a subdirectory of one worktree. */
  gitRootPath?: string;
  /** Path-nested remembered projects that live inside this folder. */
  nested?: SidebarProjectRef[];
};

export type SidebarProjectCluster =
  | { kind: 'solo'; project: SidebarProjectRef }
  | {
      kind: 'group';
      gitRepositoryId: string;
      title: string;
      members: SidebarProjectRef[];
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
  return isNestedProjectPath(inner.path, outer.path) || isSameCheckoutSubdirectory(inner, outer);
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
): SidebarProjectCluster[] {
  const rooted = attachNestedProjects(projects);
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
  for (const project of rooted) {
    if (emitted.has(project.path)) {
      continue;
    }
    const repoId = project.gitRepositoryId;
    const members = repoId ? (membersByRepo.get(repoId) ?? [project]) : [project];
    if (!repoId || members.length < 2 || !hasDistinctGitCheckouts(members)) {
      clusters.push({ kind: 'solo', project });
      emitted.add(project.path);
      continue;
    }
    const ordered = orderRepoMembers(members);
    const titleSource = ordered.find((item) => item.isPrimaryWorktree === true) ?? ordered[0];
    clusters.push({
      kind: 'group',
      gitRepositoryId: repoId,
      title: titleSource?.displayName?.trim() || projectDisplayName(titleSource?.path ?? ''),
      members: ordered,
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
function hasDistinctGitCheckouts(members: readonly SidebarProjectRef[]): boolean {
  const keys = new Set(members.map((member) => checkoutKey(member)));
  return keys.size >= 2;
}
