/**
 * Cheap before/after picture of a workspace's dirty files.
 *
 * `git status -z` (with optional locks off, so it never takes index.lock)
 * lists every path that differs from HEAD, including untracked files; each is
 * stamped with size + mtime. Diffing two fingerprints yields the paths that
 * changed in between — enough to tell an optimistic shell run that the files
 * it built or tested moved under it. A path that is dirtied and reverted
 * inside the window is missed; that is accepted.
 *
 * Not a git work tree, git missing, or a slow repo → `null`. A root that was
 * slow once is skipped for a cool-down so every shell call does not pay it.
 */
import { realpathSync } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

import { runGitCommand } from '@piwin/git';

/** Keys are paths relative to the fingerprinted root, `/`-separated. */
export type WorkspaceFingerprint = ReadonlyMap<string, string>;

const FINGERPRINT_TIMEOUT_MS = 1_500;
const SLOW_ROOT_COOLDOWN_MS = 5 * 60_000;
/** Beyond this many dirty paths the picture is not worth its stat cost. */
const MAX_FINGERPRINT_PATHS = 5_000;

const slowRootsUntil = new Map<string, number>();
/** Porcelain paths are relative to the repository top, not the session root. */
const topLevelByRoot = new Map<string, string | null>();

async function resolveTopLevel(root: string): Promise<string | null> {
  const cached = topLevelByRoot.get(root);
  if (cached !== undefined) {
    return cached;
  }
  const result = await runGitCommand({
    cwd: root,
    args: ['rev-parse', '--show-toplevel'],
    timeoutMs: FINGERPRINT_TIMEOUT_MS,
    allowFailure: true,
  });
  const topLevel = result.exitCode === 0 ? result.stdout.trim() || null : null;
  topLevelByRoot.set(root, topLevel);
  return topLevel;
}

/** Paths from `git status --porcelain=v1 -z`; renames carry their origin next. */
export function parsePorcelainZPaths(stdout: string): string[] {
  const tokens = stdout.split('\0');
  const paths: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const entry = tokens[index] ?? '';
    if (entry.length < 4) {
      continue;
    }
    const status = entry.slice(0, 2);
    paths.push(entry.slice(3));
    if (status.includes('R') || status.includes('C')) {
      const origin = tokens[index + 1];
      if (origin) {
        paths.push(origin);
      }
      index += 1;
    }
  }
  return paths;
}

async function stampPath(root: string, relativePath: string): Promise<string> {
  try {
    const stats = await lstat(join(root, relativePath));
    return `${stats.size}:${stats.mtimeMs}`;
  } catch {
    return 'missing';
  }
}

export async function captureWorkspaceFingerprint(
  root: string,
  options: { now?: () => number } = {},
): Promise<WorkspaceFingerprint | null> {
  const now = options.now ?? Date.now;
  const blockedUntil = slowRootsUntil.get(root);
  if (blockedUntil !== undefined && blockedUntil > now()) {
    return null;
  }
  const startedAt = now();
  let stdout: string;
  let topLevel: string | null;
  try {
    topLevel = await resolveTopLevel(root);
    if (topLevel === null) {
      return null;
    }
    const result = await runGitCommand({
      cwd: root,
      // `-- .` keeps a subdirectory session to its own subtree.
      args: [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
        '--ignore-submodules=all',
        '--',
        '.',
      ],
      timeoutMs: FINGERPRINT_TIMEOUT_MS,
      allowFailure: true,
      env: { GIT_OPTIONAL_LOCKS: '0' },
    });
    if (result.exitCode !== 0) {
      return null;
    }
    stdout = result.stdout;
  } catch {
    // Timeout or spawn failure: a slow or broken repo must not tax every call.
    slowRootsUntil.set(root, now() + SLOW_ROOT_COOLDOWN_MS);
    return null;
  }
  const paths = parsePorcelainZPaths(stdout);
  if (paths.length > MAX_FINGERPRINT_PATHS) {
    slowRootsUntil.set(root, now() + SLOW_ROOT_COOLDOWN_MS);
    return null;
  }
  const base = topLevel;
  const stamps = await Promise.all(paths.map((path) => stampPath(base, path)));
  if (now() - startedAt > FINGERPRINT_TIMEOUT_MS) {
    slowRootsUntil.set(root, now() + SLOW_ROOT_COOLDOWN_MS);
  }
  // Porcelain paths are relative to the repository top; callers (turn-change
  // receipts, notes) speak in paths relative to the session root.
  const realRoot = realRootOf(root);
  return new Map(
    paths.map((path, index) => [
      rootRelative(realRoot, join(base, path)),
      stamps[index] ?? 'missing',
    ]),
  );
}

function realRootOf(root: string): string {
  try {
    return realpathSync(root);
  } catch {
    return root;
  }
}

function rootRelative(root: string, absolutePath: string): string {
  const rel = relative(root, absolutePath);
  return (rel === '' || isAbsolute(rel) ? absolutePath : rel).split('\\').join('/');
}

/** Paths whose dirty state or stamp differs between two fingerprints. */
export function diffWorkspaceFingerprints(
  before: WorkspaceFingerprint,
  after: WorkspaceFingerprint,
): string[] {
  const changed = new Set<string>();
  for (const [path, stamp] of after) {
    if (before.get(path) !== stamp) {
      changed.add(path);
    }
  }
  for (const path of before.keys()) {
    if (!after.has(path)) {
      changed.add(path);
    }
  }
  return [...changed].sort();
}

export function resetWorkspaceFingerprintCooldownsForTests(): void {
  slowRootsUntil.clear();
  topLevelByRoot.clear();
}
