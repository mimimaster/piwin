/**
 * Product-owned General workspace under ~/.piwin/workspace.
 * Host creates this directory lazily; apps never invent the path.
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getPiwinGeneralWorkspacePath, getPiwinRoot } from './paths.js';

/**
 * Ensure the General workspace directory exists and return its absolute path.
 * Idempotent: safe to call on every General session create/resume.
 */
export async function ensureGeneralWorkspace(piwinRoot?: string): Promise<string> {
  const rootDir = getPiwinRoot(piwinRoot);
  const workspacePath = resolve(getPiwinGeneralWorkspacePath(rootDir));
  await mkdir(workspacePath, { recursive: true });
  return workspacePath;
}
