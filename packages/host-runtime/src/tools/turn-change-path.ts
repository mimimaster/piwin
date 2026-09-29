/**
 * Workspace-relative path for turn-change receipts; refuses escapes.
 */
import { relative, resolve } from 'node:path';

import { assertSafeRepoRelativePaths } from '@piwin/git';

export function toTurnChangeRelativePath(absolutePath: string, workspaceRoot: string): string {
  const rel = relative(resolve(workspaceRoot), resolve(absolutePath)).split('\\').join('/');
  const safe = assertSafeRepoRelativePaths(workspaceRoot, [rel]);
  const relativePath = safe[0];
  if (relativePath === undefined) {
    throw new Error('path escapes workspace');
  }
  return relativePath;
}
