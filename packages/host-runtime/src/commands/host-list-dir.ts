/**
 * host/list-dir — Host filesystem listing for the shell workspace picker.
 */
import { readdir, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { HostCommand, HostDirEntry, HostListDirData, HostResponse } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { fail, ok } from '../response-helpers.js';

const MAX_ENTRIES = 800;

export async function handleHostListDir(
  command: Extract<HostCommand, { type: 'host/list-dir' }>,
  requestId: string | undefined,
): Promise<HostResponse> {
  const homePath = os.homedir();
  const requested = command.path?.trim() || homePath;
  let targetAbsolute: string;
  try {
    targetAbsolute = path.resolve(requested);
    const fileStats = await stat(targetAbsolute);
    if (!fileStats.isDirectory()) {
      return fail(requestId, 'host/list-dir', `not a directory: ${targetAbsolute}`);
    }
    targetAbsolute = await realpath(targetAbsolute);
  } catch (error) {
    return fail(requestId, 'host/list-dir', `cannot open directory: ${formatError(error)}`);
  }

  let directoryEntries;
  try {
    directoryEntries = await readdir(targetAbsolute, { withFileTypes: true });
  } catch (error) {
    return fail(requestId, 'host/list-dir', `cannot read directory: ${formatError(error)}`);
  }

  const entries: HostDirEntry[] = [];
  for (const dirent of directoryEntries) {
    if (dirent.name === '.' || dirent.name === '..') {
      continue;
    }
    if (!command.includeHidden && dirent.name.startsWith('.')) {
      continue;
    }
    const kind = dirent.isDirectory() ? 'directory' : dirent.isFile() ? 'file' : null;
    if (kind === null) {
      continue;
    }
    entries.push({
      name: dirent.name,
      kind,
      path: path.join(targetAbsolute, dirent.name),
    });
    if (entries.length >= MAX_ENTRIES) {
      break;
    }
  }
  entries.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'directory' ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });

  const parent = path.dirname(targetAbsolute);
  const data: HostListDirData = {
    path: targetAbsolute,
    parentPath: parent === targetAbsolute ? null : parent,
    homePath,
    entries,
  };
  return ok(requestId, 'host/list-dir', data);
}
