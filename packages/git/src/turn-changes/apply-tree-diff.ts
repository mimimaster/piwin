/**
 * Apply a prepared beforeTree→afterTree delta through the bounded writer.
 * Does not git apply/checkout/reset the parent worktree.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { runGitCommand } from '../git-command-runner.js';
import { deleteTurnChangeFile, writeTurnChangeFile } from './file-writer.js';
import type { TurnChangeObjectStore } from './object-store.js';

const execFileAsync = promisify(execFile);
const MAX_BLOB_BYTES = 20 * 1024 * 1024;

export async function applyTreeDiffToWorkspace(input: {
  workspaceRoot: string;
  beforeTree: string;
  afterTree: string;
  store: TurnChangeObjectStore;
}): Promise<{ written: string[] }> {
  const listed = await runGitCommand({
    cwd: input.workspaceRoot,
    args: ['diff', '--name-status', '-z', input.beforeTree, input.afterTree, '--'],
  });
  const written: string[] = [];
  const records = listed.stdout.split('\0').filter((part) => part.length > 0);
  let index = 0;
  while (index < records.length) {
    const status = records[index];
    const path = records[index + 1];
    index += 2;
    if (!status || !path) continue;
    const relativePath = path.replace(/\\/g, '/');
    if (status.startsWith('D')) {
      await deleteTurnChangeFile({
        workspaceRoot: input.workspaceRoot,
        relativePath,
        store: input.store,
      });
      written.push(relativePath);
      continue;
    }
    const bytes = await catTreePath(input.workspaceRoot, input.afterTree, relativePath);
    await writeTurnChangeFile({
      workspaceRoot: input.workspaceRoot,
      relativePath,
      bytes,
      store: input.store,
    });
    written.push(relativePath);
  }
  return { written };
}

async function catTreePath(
  workspaceRoot: string,
  tree: string,
  relativePath: string,
): Promise<Uint8Array> {
  const spec = `${tree}:${relativePath}`;
  const { stdout } = await execFileAsync('git', ['cat-file', 'blob', spec], {
    cwd: workspaceRoot,
    encoding: 'buffer',
    maxBuffer: MAX_BLOB_BYTES,
    timeout: 15_000,
  });
  return new Uint8Array(stdout);
}
