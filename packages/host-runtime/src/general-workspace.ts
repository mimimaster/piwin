/**
 * Product-owned workspace under ~/.piwin/workspace.
 * Host creates this directory lazily; apps never invent the path.
 *
 * General chat (`kind: 'general'`) uses it as cwd with conversation rules.
 * No Repo agent sessions use the same directory as a built-in project root.
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getPiwinGeneralWorkspacePath, getPiwinRoot } from './paths.js';

/**
 * Ensure the workspace directory exists and return its absolute path.
 * Idempotent: safe to call on every General / No Repo session create/resume.
 */
export async function ensureGeneralWorkspace(piwinRoot?: string): Promise<string> {
  const rootDir = getPiwinRoot(piwinRoot);
  const workspacePath = resolve(getPiwinGeneralWorkspacePath(rootDir));
  await mkdir(workspacePath, { recursive: true });
  return workspacePath;
}

/** True when `projectPath` is the product-owned No Repo / General workspace. */
export function isGeneralWorkspacePath(projectPath: string, piwinRoot?: string): boolean {
  const trimmed = projectPath.trim();
  if (!trimmed) {
    return false;
  }
  const workspace = resolve(getPiwinGeneralWorkspacePath(getPiwinRoot(piwinRoot)));
  return resolve(trimmed) === workspace;
}
