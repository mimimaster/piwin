import path from 'node:path';
import type { ProjectWorktreeListing, RemoteProjectSummary } from '@piwin/contracts';
import { createRemoteProjectId, isRemoteProjectId } from '@piwin/host-runtime';
import { asRecord } from './remote-projection-helpers.js';

export function projectProjectMutation(data: unknown): {
  projectId: string;
  path?: string;
  trusted: boolean;
  trust: 'trusted' | 'untrusted';
} {
  const record = asRecord(data);
  const issuedId = typeof record?.projectId === 'string' ? record.projectId : '';
  const hostPath = typeof record?.path === 'string' ? record.path : '';
  const projectId = isRemoteProjectId(issuedId)
    ? issuedId
    : hostPath
      ? createRemoteProjectId(hostPath)
      : '';
  const trusted = record?.trusted === true || record?.trust === 'trusted';
  return {
    projectId,
    ...(hostPath.length > 0 && !isRemoteProjectId(hostPath) ? { path: hostPath } : {}),
    trusted,
    trust: trusted ? 'trusted' : 'untrusted',
  };
}

export function isGitWorkspacePending(data: unknown): boolean {
  return asRecord(data)?.gitWorkspacePending === true;
}

export function projectProjects(data: unknown): RemoteProjectSummary[] {
  const projects = asRecord(data)?.projects;
  if (!Array.isArray(projects)) return [];

  const projected: RemoteProjectSummary[] = [];
  for (const project of projects) {
    const record = asRecord(project);
    if (record === undefined || typeof record.path !== 'string') continue;
    const displayName =
      typeof record.displayName === 'string' && record.displayName.trim().length > 0
        ? record.displayName
        : path.basename(record.path) || 'Project';
    const trust =
      record.trust === 'trusted' || record.trust === 'untrusted' ? record.trust : 'unknown';
    const summary: RemoteProjectSummary = {
      projectId: createRemoteProjectId(record.path),
      displayName,
      path: record.path,
      trust,
    };
    if (typeof record.lastOpenedAt === 'string') summary.lastOpenedAt = record.lastOpenedAt;
    if (typeof record.gitRepositoryId === 'string' && record.gitRepositoryId.length > 0) {
      summary.gitRepositoryId = record.gitRepositoryId;
    }
    if (record.isPrimaryWorktree === true || record.isPrimaryWorktree === false) {
      summary.isPrimaryWorktree = record.isPrimaryWorktree;
    }
    if (typeof record.currentBranch === 'string' && record.currentBranch.length > 0) {
      summary.currentBranch = record.currentBranch;
    }
    if (typeof record.gitRootPath === 'string' && record.gitRootPath.length > 0) {
      summary.gitRootPath = record.gitRootPath;
    }
    if (record.isCheckoutRoot === true || record.isCheckoutRoot === false) {
      summary.isCheckoutRoot = record.isCheckoutRoot;
    }
    if (record.workspaceAvailability === 'missing') summary.workspaceAvailability = 'missing';
    projected.push(summary);
  }
  return projected;
}

export function projectWorktrees(data: unknown): ProjectWorktreeListing[] {
  const worktrees = asRecord(data)?.worktrees;
  if (!Array.isArray(worktrees)) return [];
  return worktrees.flatMap((worktree): ProjectWorktreeListing[] => {
    const record = asRecord(worktree);
    if (
      typeof record?.gitRepositoryId !== 'string' ||
      typeof record.path !== 'string' ||
      record.path.length === 0
    ) return [];
    return [{
      gitRepositoryId: record.gitRepositoryId,
      path: record.path,
      branch: typeof record.branch === 'string' ? record.branch : null,
      isPrimary: record.isPrimary === true,
    }];
  });
}
