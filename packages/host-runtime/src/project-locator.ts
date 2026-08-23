/**
 * Bind a shell project locator (Host path or opaque projectId) to a stored path.
 * Remote shells send project-<24 hex>; the local sidecar still sends filesystem paths.
 */
import { listProjects, resolveProjectPathById } from '@piwin/project';
import { getPiwinProjectsPath, getPiwinRoot } from './paths.js';
import { isRemoteProjectId } from './remote-project-id.js';

export type BoundProjectLocator =
  | { ok: true; path: string }
  | { ok: false; error: 'project-root-required' | 'unknown-project' };

export function bindProjectLocator(
  locator: string,
  projects: readonly { path: string }[],
): BoundProjectLocator {
  const trimmed = locator.trim();
  if (!trimmed) {
    return { ok: false, error: 'project-root-required' };
  }
  if (isRemoteProjectId(trimmed)) {
    const path = resolveProjectPathById(projects, trimmed);
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
  const projects = await listProjects(getPiwinProjectsPath(getPiwinRoot(piwinRoot)));
  return bindProjectLocator(locator, projects);
}
