import { constants } from 'node:fs';
import { open, readdir, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

/** Read only a bounded regular file beneath the trusted bound backend session. */
export async function readBackendWorkflowFile(root: string, relativePath: string, maxBytes: number): Promise<string | undefined> {
  const target = resolve(root, relativePath);
  if (!target.startsWith(resolve(root) + sep)) throw new Error('workflow path escapes session root');
  try {
    const realRoot = await realpath(root);
    const realTarget = await realpath(target);
    if (!realTarget.startsWith(realRoot + sep)) throw new Error('workflow symlink escapes session root');
    const handle = await open(realTarget, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const details = await handle.stat();
      if (!details.isFile() || details.size > maxBytes) throw new Error('workflow file exceeds read limit');
      const bytes = Buffer.alloc(details.size);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      return bytes.subarray(0, bytesRead).toString('utf8');
    } finally { await handle.close(); }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function listBackendWorkflowIds(root: string): Promise<string[]> {
  try {
    const realRoot = await realpath(root);
    const directory = await realpath(resolve(root, 'workflows'));
    if (!directory.startsWith(realRoot + sep)) throw new Error('workflow directory escapes session root');
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && /^wf_[a-zA-Z0-9_-]+$/.test(entry.name))
      .map((entry) => entry.name).sort().reverse().slice(0, 8);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}
