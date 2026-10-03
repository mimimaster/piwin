import { useState } from 'react';
import type { HostResponse, ProjectWorktreeListing, RemoteProjectSummary } from '@piwin/contracts';

/** One in-memory snapshot from the existing project/list read; never persisted. */
export interface MobileProjectList {
  status: 'loading' | 'ready' | 'not-exposed' | 'error';
  projects: RemoteProjectSummary[];
  /** Undefined means Host did not expose inventory, not an empty inventory. */
  worktrees?: ProjectWorktreeListing[];
  gitWorkspacePending?: true;
  error?: string;
}

function emptyProjectList(): MobileProjectList {
  return { status: 'loading', projects: [] };
}

export function useMobileProjectList() {
  const [projectList, setProjectList] = useState<MobileProjectList>(emptyProjectList);
  return {
    projects: projectList.projects,
    projectList,
    setProjectList,
    resetProjectList: () => setProjectList(emptyProjectList()),
  };
}

/** Preserve only validated, already-public display fields. Unknown is never false. */
export function readProjects(response: HostResponse): RemoteProjectSummary[] {
  if (!response.success || !isRecord(response.data) || !Array.isArray(response.data.projects)) {
    return [];
  }
  return response.data.projects.flatMap((value): RemoteProjectSummary[] => {
    if (!isRecord(value) || !nonempty(value.projectId) || typeof value.displayName !== 'string') {
      return [];
    }
    const project: RemoteProjectSummary = {
      projectId: value.projectId,
      displayName: value.displayName.trim() || value.projectId,
    };
    for (const key of ['path', 'lastOpenedAt', 'gitRepositoryId', 'currentBranch', 'gitRootPath'] as const) {
      if (nonempty(value[key])) project[key] = value[key];
    }
    for (const key of ['isPrimaryWorktree', 'isCheckoutRoot'] as const) {
      if (typeof value[key] === 'boolean') project[key] = value[key];
    }
    if (value.trust === 'trusted' || value.trust === 'untrusted' || value.trust === 'unknown') {
      project.trust = value.trust;
    }
    if (value.workspaceAvailability === 'missing') project.workspaceAvailability = 'missing';
    return [project];
  });
}

export function readProjectList(response: HostResponse | undefined): MobileProjectList {
  if (response === undefined) return { status: 'not-exposed', projects: [] };
  if (!response.success) return { status: 'error', projects: [], error: response.error };
  if (!isRecord(response.data) || !Array.isArray(response.data.projects)) {
    return { status: 'error', projects: [], error: 'Host 返回了无法识别的项目列表。' };
  }
  const snapshot: MobileProjectList = { status: 'ready', projects: readProjects(response) };
  if (Array.isArray(response.data.worktrees)) {
    snapshot.worktrees = response.data.worktrees.flatMap((value): ProjectWorktreeListing[] => {
      if (!isRecord(value) || !nonempty(value.gitRepositoryId) || !nonempty(value.path) ||
          !(value.branch === null || typeof value.branch === 'string') ||
          typeof value.isPrimary !== 'boolean') return [];
      return [{
        gitRepositoryId: value.gitRepositoryId,
        path: value.path,
        branch: nonempty(value.branch) ? value.branch : null,
        isPrimary: value.isPrimary,
      }];
    });
  }
  if (response.data.gitWorkspacePending === true) snapshot.gitWorkspacePending = true;
  return snapshot;
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
