import type {
  SessionIndexRecord,
  SessionScope,
  SubagentIsolationMode,
} from '@piwin/contracts';

export type SubagentParentLocation = {
  scope: SessionScope;
  workspacePath: string;
};

/**
 * Resolve child product scope from the durable parent record.
 * The workspace lease may later replace cwd, but it never changes product
 * scope. General sessions have no Git authority for worktree isolation.
 */
export function resolveSubagentParentLocation(
  parentRecord: Pick<SessionIndexRecord, 'projectPath' | 'scope'>,
  isolation: SubagentIsolationMode,
  generalWorkspacePath: string,
): SubagentParentLocation {
  const legacyProjectPath = parentRecord.projectPath.trim();
  const scope: SessionScope =
    parentRecord.scope ??
    (legacyProjectPath
      ? { kind: 'project', projectPath: legacyProjectPath }
      : { kind: 'general' });

  if (scope.kind === 'general') {
    if (isolation === 'worktree') {
      throw new Error('worktree subagents require a project-scoped parent session');
    }
    return { scope, workspacePath: generalWorkspacePath };
  }

  const projectPath = scope.projectPath.trim();
  if (!projectPath) {
    throw new Error('project scope requires a non-empty projectPath');
  }
  return {
    scope: { kind: 'project', projectPath },
    workspacePath: projectPath,
  };
}
