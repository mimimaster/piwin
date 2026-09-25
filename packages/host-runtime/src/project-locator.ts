/**
 * Bind a shell project locator (Host path or opaque projectId) to a stored path.
 * Remote shells send project-<24 hex>; the local sidecar still sends filesystem paths.
 */
import { listProjects, projectIdForPath, resolveProjectPathById } from '@piwin/project';
import { getPiwinGeneralWorkspacePath, getPiwinProjectsPath, getPiwinRoot } from './paths.js';
import { isRemoteProjectId } from './remote-project-id.js';

export type BoundProjectLocator =
  | { ok: true; path: string }
  | { ok: false; error: 'project-root-required' | 'unknown-project' };

export type BindProjectLocatorOptions = {
  /**
   * The built-in No Repo workspace. Host status advertises its id
   * (`generalWorkspaceProjectId`) to remote shells, but it is not always a
   * registered project, so the id must resolve here too.
   */
  generalWorkspacePath?: string;
};

export function bindProjectLocator(
  locator: string,
  projects: readonly { path: string }[],
  options: BindProjectLocatorOptions = {},
): BoundProjectLocator {
  const trimmed = locator.trim();
  if (!trimmed) {
    return { ok: false, error: 'project-root-required' };
  }
  if (isRemoteProjectId(trimmed)) {
    const path =
      resolveProjectPathById(projects, trimmed) ??
      (options.generalWorkspacePath && projectIdForPath(options.generalWorkspacePath) === trimmed
        ? options.generalWorkspacePath
        : undefined);
    if (path === undefined) {
      return { ok: false, error: 'unknown-project' };
    }
    return { ok: true, path };
  }
  return { ok: true, path: trimmed };
}

export async function bindProjectLocatorFromRoot(
  locator: string,
  piwinRoot?: string,
): Promise<BoundProjectLocator> {
  const rootDir = getPiwinRoot(piwinRoot);
  const projects = await listProjects(getPiwinProjectsPath(rootDir));
  return bindProjectLocator(locator, projects, {
    generalWorkspacePath: getPiwinGeneralWorkspacePath(rootDir),
  });
}
