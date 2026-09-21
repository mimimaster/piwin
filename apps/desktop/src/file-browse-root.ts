/**
 * File-preview browse root for the right inspector.
 *
 * Project sessions use the opened project. Chat / Conversation uses the
 * product General workspace so generated files can still be listed and
 * previewed without registering that folder as a user project.
 */
export function resolveFileBrowseRoot(input: {
  projectPath?: string | null | undefined;
  generalWorkspacePath?: string | null | undefined;
}): string | null {
  const project = input.projectPath?.trim();
  if (project) {
    return project;
  }
  const general = input.generalWorkspacePath?.trim();
  if (general) {
    return general;
  }
  return null;
}

/**
 * Built-in No Repo key: the Host workspace path when hello exposes it, else the
 * opaque locator. Remote projections never send the path, so remote shells only
 * know the id — every No Repo decision compares identity against this key.
 */
export function resolveNoRepoWorkspaceKey(input: {
  generalWorkspacePath?: string | null | undefined;
  generalWorkspaceProjectId?: string | null | undefined;
}): string | null {
  const path = input.generalWorkspacePath?.trim();
  if (path) {
    return path;
  }
  const id = input.generalWorkspaceProjectId?.trim();
  return id && id.length > 0 ? id : null;
}

/** Path identity for Host roots: trim and ignore a trailing slash. */
export function sameHostPath(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = normalizeHostPath(left);
  const b = normalizeHostPath(right);
  return a.length > 0 && a === b;
}

/**
 * True for the built-in No Repo root. Matches the No Repo key (Host workspace
 * path, or the opaque locator remote sends instead), and the default
 * `~/.piwin/workspace` even if hello has not landed.
 */
export function isNoRepoProjectPath(
  path: string | null | undefined,
  generalWorkspacePath?: string | null,
): boolean {
  if (sameHostPath(path, generalWorkspacePath)) {
    return true;
  }
  const normalized = normalizeHostPath(path);
  return normalized.endsWith('/.piwin/workspace');
}

/**
 * First-send path for a No Repo draft: the New Agent scope, then the active
 * project. Host hello is deliberately not a candidate — No Repo is an explicit
 * binding, and a General draft must stay general (Conversations) instead of
 * being reclassified into the built-in project on first send.
 */
export function resolveNoRepoSendPath(input: {
  draftScope: { kind: string; projectPath?: string };
  projectPath?: string | null;
  generalWorkspacePath?: string | null | undefined;
}): string | null {
  const candidates: Array<string | null | undefined> = [
    input.draftScope.kind === 'project' ? input.draftScope.projectPath : undefined,
    input.projectPath,
  ];
  for (const candidate of candidates) {
    if (isNoRepoProjectPath(candidate, input.generalWorkspacePath)) {
      return normalizeHostPath(candidate);
    }
  }
  return null;
}

function normalizeHostPath(value: string | null | undefined): string {
  return value?.trim().replace(/[\\/]+$/, '').replace(/\\/g, '/') ?? '';
}
