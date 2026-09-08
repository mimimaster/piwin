/**
 * Classify turn-change paths with lstat and reject symlink escapes.
 * Does not create, delete, or follow a write outside the workspace.
 */
import type { Stats } from 'node:fs';
import { lstat, readlink, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { assertSafeRepoRelativePaths } from '../path-safety.js';

export type TurnChangePathKind = 'file' | 'directory' | 'symlink' | 'missing' | 'unsupported';

export type ResolvedTurnChangePath = {
  relativePath: string;
  absolutePath: string;
  kind: TurnChangePathKind;
};

export async function resolveTurnChangePath(input: {
  workspaceRoot: string;
  relativePath: string;
}): Promise<ResolvedTurnChangePath> {
  if (!isAbsolute(input.workspaceRoot)) {
    throw new Error('workspaceRoot must be an absolute path');
  }

  const safe = assertSafeRepoRelativePaths(input.workspaceRoot, [input.relativePath]);
  const relativePath = safe[0];
  if (relativePath === undefined) {
    throw new Error('relativePath is empty');
  }

  const workspaceRoot = resolve(input.workspaceRoot);
  const rootReal = await realpath(workspaceRoot);
  const rootStats = await lstat(rootReal);
  if (!rootStats.isDirectory()) {
    throw new Error('workspaceRoot must be a directory');
  }

  const absolutePath = resolve(workspaceRoot, relativePath);
  const segments = relativePath.split('/');
  let current = workspaceRoot;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined || segment === '') {
      throw new Error('relativePath is empty');
    }
    current = join(current, segment);
    const isFinal = index === segments.length - 1;
    let stats: Stats;
    try {
      stats = await lstat(current);
    } catch (error) {
      if (errorHasCode(error, 'ENOENT')) {
        return { relativePath, absolutePath, kind: 'missing' };
      }
      throw error;
    }

    if (stats.isSymbolicLink()) {
      await assertSymlinkInsideWorkspace(rootReal, current);
      if (isFinal) {
        return { relativePath, absolutePath, kind: 'symlink' };
      }
      continue;
    }

    if (isFinal) {
      return { relativePath, absolutePath, kind: kindFromStats(stats) };
    }
  }

  throw new Error('relativePath is empty');
}

export async function assertWritableTurnChangeFile(input: {
  workspaceRoot: string;
  relativePath: string;
}): Promise<ResolvedTurnChangePath> {
  const resolved = await resolveTurnChangePath(input);
  if (resolved.kind !== 'file' && resolved.kind !== 'missing') {
    throw new Error(`path is not a writable turn-change file: ${resolved.kind}`);
  }
  return resolved;
}

function kindFromStats(stats: Stats): TurnChangePathKind {
  if (stats.isFile()) {
    return 'file';
  }
  if (stats.isDirectory()) {
    return 'directory';
  }
  return 'unsupported';
}

async function assertSymlinkInsideWorkspace(rootReal: string, linkPath: string): Promise<void> {
  const linkText = await readlink(linkPath);
  const target = isAbsolute(linkText)
    ? resolve(linkText)
    : resolve(await realParentDir(linkPath), linkText);
  await assertInsideWorkspace(rootReal, target);
  try {
    await assertInsideWorkspace(rootReal, await realpath(linkPath));
  } catch (error) {
    if (errorHasCode(error, 'ENOENT') || errorHasCode(error, 'ENOTDIR')) {
      return;
    }
    throw error;
  }
}

async function realParentDir(linkPath: string): Promise<string> {
  try {
    return await realpath(dirname(linkPath));
  } catch (error) {
    if (errorHasCode(error, 'ENOENT') || errorHasCode(error, 'ENOTDIR')) {
      throw new Error('path escapes workspace');
    }
    throw error;
  }
}

async function assertInsideWorkspace(rootReal: string, candidateAbs: string): Promise<void> {
  const canonical = await canonicalizeForContainment(candidateAbs);
  const rel = relative(rootReal, canonical);
  if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) {
    throw new Error('path escapes workspace');
  }
}

export async function canonicalizeForContainment(candidateAbs: string): Promise<string> {
  const resolved = resolve(candidateAbs);
  try {
    return await realpath(resolved);
  } catch (error) {
    if (!errorHasCode(error, 'ENOENT') && !errorHasCode(error, 'ENOTDIR')) {
      throw error;
    }
  }

  const parts: string[] = [];
  let current = resolved;
  while (true) {
    const parent = dirname(current);
    const name = basename(current);
    if (parent === current) {
      return resolve(current, ...parts, name);
    }
    parts.unshift(name);
    current = parent;
    try {
      return resolve(await realpath(current), ...parts);
    } catch (error) {
      if (!errorHasCode(error, 'ENOENT') && !errorHasCode(error, 'ENOTDIR')) {
        throw error;
      }
    }
  }
}

export type FileLockKeyFailure = 'enotdir' | 'eacces' | 'eloop' | 'invalid';

/**
 * Canonical lock identity for a target file. Missing files use the realpath of
 * the nearest existing ancestor plus the missing suffix, so directory symlink
 * aliases share one key. ENOTDIR on a non-directory ancestor is a hard failure.
 */
export async function resolveFileLockKey(
  absolutePath: string,
): Promise<{ ok: true; key: string } | { ok: false; reason: FileLockKeyFailure }> {
  const resolved = resolve(absolutePath);
  try {
    return { ok: true, key: await realpath(resolved) };
  } catch (error) {
    const mapped = mapLockKeyError(error);
    if (mapped !== 'enoent') {
      return { ok: false, reason: mapped };
    }
  }

  const missing: string[] = [];
  let current = resolved;
  while (true) {
    const parent = dirname(current);
    const name = basename(current);
    if (parent === current) {
      return { ok: true, key: resolve(current, ...missing, name) };
    }
    missing.unshift(name);
    current = parent;
    try {
      const ancestorReal = await realpath(current);
      const ancestorStats = await lstat(ancestorReal);
      if (!ancestorStats.isDirectory()) {
        return { ok: false, reason: 'enotdir' };
      }
      return { ok: true, key: resolve(ancestorReal, ...missing) };
    } catch (error) {
      const mapped = mapLockKeyError(error);
      if (mapped !== 'enoent') {
        return { ok: false, reason: mapped };
      }
    }
  }
}

function mapLockKeyError(error: unknown): FileLockKeyFailure | 'enoent' {
  if (errorHasCode(error, 'ENOENT')) {
    return 'enoent';
  }
  if (errorHasCode(error, 'ENOTDIR')) {
    return 'enotdir';
  }
  if (errorHasCode(error, 'EACCES')) {
    return 'eacces';
  }
  if (errorHasCode(error, 'ELOOP')) {
    return 'eloop';
  }
  return 'invalid';
}

function errorHasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
