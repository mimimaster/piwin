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
