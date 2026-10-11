import { mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { HostCreateEntryInput, HostDirEntry, HostEntryProblemCode } from '@piwin/contracts';
import { isValidHostEntryName } from '@piwin/contracts';

export class HostEntryCreateError extends Error {
  override readonly name = 'HostEntryCreateError';
  constructor(
    readonly code: HostEntryProblemCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** The operator picks any existing Host folder; no project registration is required. */
export async function createHostEntry(input: HostCreateEntryInput): Promise<HostDirEntry> {
  const style = process.platform === 'win32' ? 'windows' : 'posix';
  if (
    !isValidHostEntryName(input.name, style) ||
    (input.kind !== 'directory' && input.kind !== 'file')
  ) {
    throw new HostEntryCreateError('host-entry-invalid-name', 'Enter a valid file or folder name.');
  }
  if (
    typeof input.parentPath !== 'string' ||
    !path.isAbsolute(input.parentPath) ||
    input.parentPath.length > 4096 ||
    input.parentPath.includes('\0')
  ) {
    throw new HostEntryCreateError(
      'host-entry-not-directory',
      'Choose an existing absolute Host directory.',
    );
  }
  try {
    const parentPath = await realpath(input.parentPath);
    if (!(await stat(parentPath)).isDirectory()) {
      throw new HostEntryCreateError('host-entry-not-directory', 'The parent is not a directory.');
    }
    const entryPath = path.join(parentPath, input.name);
    // Exclusive creation also rejects existing symlinks, including dangling ones.
    if (input.kind === 'directory') await mkdir(entryPath);
    else await writeFile(entryPath, '', { flag: 'wx' });
    return { name: input.name, kind: input.kind, path: entryPath };
  } catch (error) {
    if (error instanceof HostEntryCreateError) throw error;
    const code =
      typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    switch (code) {
      case 'EEXIST':
        throw new HostEntryCreateError(
          'host-entry-already-exists',
          'A file or folder with this name already exists.',
          { cause: error },
        );
      case 'EACCES':
      case 'EPERM':
      case 'EROFS':
        throw new HostEntryCreateError(
          'host-entry-permission-denied',
          'You cannot create items in this folder.',
          { cause: error },
        );
      case 'ENOENT':
      case 'ENOTDIR':
        throw new HostEntryCreateError(
          'host-entry-not-directory',
          'The parent folder no longer exists.',
          { cause: error },
        );
      default:
        throw new HostEntryCreateError(
          'host-entry-create-failed',
          'Could not create the item. Check the name and folder, then try again.',
          { cause: error },
        );
    }
  }
}
