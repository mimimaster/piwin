import { projectDisplayName } from './project-display-name';

export type SidebarProjectRef = {
  path: string;
  displayName?: string;
  gitRepositoryId?: string;
  isPrimaryWorktree?: boolean;
  currentBranch?: string;
};

export type SidebarProjectCluster =
  | { kind: 'solo'; project: SidebarProjectRef }
  | {
      kind: 'group';
      gitRepositoryId: string;
      title: string;
      members: SidebarProjectRef[];
    };

/**
 * Cluster remembered projects for the sidebar.
 * Same `gitRepositoryId` with 2+ members becomes one group; a lone worktree
 * stays a flat folder so ordinary projects do not gain an extra indent.
 */
export function clusterProjectsByRepository(
  projects: readonly SidebarProjectRef[],
): SidebarProjectCluster[] {
  const membersByRepo = new Map<string, SidebarProjectRef[]>();
  for (const project of projects) {
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
  for (const project of projects) {
    if (emitted.has(project.path)) {
      continue;
    }
    const repoId = project.gitRepositoryId;
    const members = repoId ? (membersByRepo.get(repoId) ?? [project]) : [project];
    if (!repoId || members.length < 2) {
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
