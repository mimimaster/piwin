/**
 * Trusted roots for managed process / job cwd validation.
 *
 * The built-in No Repo workspace is Host-owned and deliberately absent from
 * `projects.json`, but the No Repo spec keeps it always trusted. Without it in
 * this list every shell call inside No Repo dies as "cwd is outside trusted
 * projects" even though the capability layer already trusts that path.
 */
import { listProjects } from '@piwin/project';
import { getPiwinGeneralWorkspacePath, getPiwinProjectsPath, getPiwinRoot } from './paths.js';

export async function listTrustedProjectRoots(piwinRoot?: string): Promise<string[]> {
  const rootDir = getPiwinRoot(piwinRoot);
  const projects = await listProjects(getPiwinProjectsPath(rootDir));
  return [
    getPiwinGeneralWorkspacePath(rootDir),
    ...projects.filter((project) => project.trust === 'trusted').map((project) => project.path),
  ];
}
