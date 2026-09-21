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
 * True for the built-in No Repo root. Matches Host `generalWorkspacePath` when
 * known, and the default `~/.piwin/workspace` even if hello has not landed.
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
 * First-send path for a No Repo draft. Looks at the New Agent scope, the
 * active project, then Host hello — Send must not depend on only one of them.
 */
export function resolveNoRepoSendPath(input: {
  draftScope: { kind: string; projectPath?: string };
  projectPath?: string | null;
  generalWorkspacePath?: string | null | undefined;
}): string | null {
  const candidates: Array<string | null | undefined> = [
    input.draftScope.kind === 'project' ? input.draftScope.projectPath : undefined,
    input.projectPath,
    input.generalWorkspacePath,
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
