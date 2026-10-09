import type { RemoteProjectSummary } from '@piwin/contracts';

export type TuiLaunchScope = {
  /** Absent means the general workspace. */
  projectId?: string;
  /** Told to the user once when the launch did not get the scope it asked for. */
  notice?: string;
};

/**
 * Which project a launch works in. `--project` wins; otherwise a registered
 * project whose root is `--project-path`, or the current directory. An
 * unregistered directory means the general workspace: the TUI never registers
 * or trusts a folder on its own. Falling back from a directory the user named
 * is said out loud; falling back from the current directory is the normal case.
 */
export function resolveTuiLaunchScope(input: {
  projects: readonly Pick<RemoteProjectSummary, 'projectId' | 'path'>[];
  explicitProjectId: string | undefined;
  explicitPath: string | undefined;
  cwd: string;
  canonicalPath: (path: string) => string;
}): TuiLaunchScope {
  if (input.explicitProjectId !== undefined) return { projectId: input.explicitProjectId };
  const directory = input.canonicalPath(input.explicitPath ?? input.cwd);
  const project = input.projects.find(
    (candidate) => candidate.path !== undefined && input.canonicalPath(candidate.path) === directory,
  );
  if (project !== undefined) return { projectId: project.projectId };
  if (input.explicitPath === undefined) return {};
  return {
    notice: `「${input.explicitPath}」还不是已信任的项目，现在在通用对话里，读不到这个文件夹。先在 Desktop 里打开并信任它，再重新启动。`,
  };
}
