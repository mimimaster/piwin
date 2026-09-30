/**
 * Copy one undo/redo's pre-operation backup out of the object store.
 *
 * Writes a brand-new directory `piwin-undo-backup-<operationId>/` under a
 * caller-chosen destination on the Host machine: one file per path that
 * existed before the operation (same relative layout) plus `manifest.json`
 * with each path's sha256 and whether it existed. Never writes into the
 * workspace, never overwrites anything: an existing target directory, a
 * relative or missing destination, or a destination inside the workspace is
 * refused before any byte is written.
 */
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { realpath } from 'node:fs/promises';

import type { TurnChangeObjectStore } from './object-store.js';
import type { TurnChangeOperationFileRecord } from './operation-store.js';

export type TurnChangeBackupExportRefusal =
  | 'destination-not-absolute'
  | 'destination-missing'
  | 'destination-inside-workspace'
  | 'destination-exists'
  | 'backup-missing';

export class TurnChangeBackupExportError extends Error {
  override readonly name = 'TurnChangeBackupExportError';
  constructor(
    readonly code: TurnChangeBackupExportRefusal,
    message: string,
  ) {
    super(message);
  }
}

export type TurnChangeBackupManifest = {
  operationId: string;
  exportedAt: string;
  files: Array<{ relativePath: string; existed: boolean; sha256: string | null }>;
};

export async function exportTurnChangeBackup(input: {
  operationId: string;
  files: readonly TurnChangeOperationFileRecord[];
  objectStore: TurnChangeObjectStore;
  workspaceRoot: string;
  destination: string;
  now?: () => Date;
}): Promise<{ destination: string; exportedPaths: string[] }> {
  if (!isAbsolute(input.destination)) {
    throw new TurnChangeBackupExportError('destination-not-absolute', 'destination must be an absolute path');
  }
  const parent = await realpath(input.destination).catch(() => undefined);
  const parentInfo = parent ? await stat(parent).catch(() => undefined) : undefined;
  if (!parent || !parentInfo?.isDirectory()) {
    throw new TurnChangeBackupExportError('destination-missing', 'destination must be an existing directory');
  }
  const workspace = await realpath(input.workspaceRoot).catch(() => resolve(input.workspaceRoot));
  if (isInside(parent, workspace)) {
    throw new TurnChangeBackupExportError(
      'destination-inside-workspace',
      'destination must be outside the workspace',
    );
  }
  const target = join(parent, `piwin-undo-backup-${sanitizeId(input.operationId)}`);
  if (await stat(target).then(() => true, () => false)) {
    throw new TurnChangeBackupExportError('destination-exists', `${target} already exists`);
  }

  // Read every backup first: a missing object refuses the export untouched.
  const entries: Array<{ relativePath: string; bytes: Uint8Array | null; sha256: string | null }> = [];
  for (const file of input.files) {
    const sha = file.fromExists ? (file.backupSha ?? file.fromSha) : null;
    if (sha === null) {
      entries.push({ relativePath: file.relativePath, bytes: null, sha256: null });
      continue;
    }
    const bytes = await input.objectStore.get(sha).catch(() => undefined);
    if (!bytes) {
      throw new TurnChangeBackupExportError('backup-missing', `backup for ${file.relativePath} is gone`);
    }
    entries.push({ relativePath: file.relativePath, bytes, sha256: sha });
  }

  // Build beside the target, then publish with one rename (no half export).
  const staging = `${target}.partial-${String(process.pid)}-${String(Date.now())}`;
  try {
    await mkdir(staging, { recursive: false });
    for (const entry of entries) {
      if (entry.bytes === null) continue;
      const out = resolve(staging, entry.relativePath);
      if (!isInside(out, staging)) {
        throw new TurnChangeBackupExportError('backup-missing', `unsafe path ${entry.relativePath}`);
      }
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, entry.bytes, { flag: 'wx' });
    }
    const manifest: TurnChangeBackupManifest = {
      operationId: input.operationId,
      exportedAt: (input.now ?? (() => new Date()))().toISOString(),
      files: entries.map((entry) => ({
        relativePath: entry.relativePath,
        existed: entry.bytes !== null,
        sha256: entry.sha256,
      })),
    };
    await writeFile(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    // rename refuses a non-empty existing target, so a race cannot overwrite.
    await rename(staging, target);
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return {
    destination: target,
    exportedPaths: entries.filter((entry) => entry.bytes !== null).map((entry) => entry.relativePath),
  };
}

function isInside(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.startsWith(`..${sep}`));
}

function sanitizeId(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, '_');
}
