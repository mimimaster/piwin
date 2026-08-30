/**
 * Diff two CAS objects with git --no-index.
 * Missing sides use empty temp files (not /dev/null). Binary numstat `-` stays null.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { runGitCommand } from '../git-command-runner.js';
import type { TurnChangeObjectStore } from './object-store.js';

const DIFF_FLAGS = ['--no-index', '--no-ext-diff', '--no-textconv', '--no-renames'] as const;
const ALLOWED_DIFF_EXITS = [0, 1] as const;
const BEFORE_NAME = 'before';
const AFTER_NAME = 'after';

export async function diffTurnChangeObjects(input: {
  store: TurnChangeObjectStore;
  beforeSha: string | null;
  afterSha: string | null;
  pathLabel: string;
}): Promise<{
  additions: number | null;
  deletions: number | null;
  binary: boolean;
  patch?: string;
}> {
  const tempDir = join(input.store.rootDir, 'temp', randomUUID());
  const beforePath = join(tempDir, BEFORE_NAME);
  const afterPath = join(tempDir, AFTER_NAME);

  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(beforePath, await readSide(input.store, input.beforeSha));
    await writeFile(afterPath, await readSide(input.store, input.afterSha));

    const numstat = await runGitCommand({
      cwd: tempDir,
      args: ['diff', ...DIFF_FLAGS, '--numstat', '-z', '--', BEFORE_NAME, AFTER_NAME],
      allowedExitCodes: ALLOWED_DIFF_EXITS,
    });
    const parsed = parseTurnChangeNumstat(numstat.stdout);
    if (parsed.binary) {
      return { additions: null, deletions: null, binary: true };
    }
    if (parsed.additions === 0 && parsed.deletions === 0) {
      return { additions: 0, deletions: 0, binary: false };
    }

    const unified = await runGitCommand({
      cwd: tempDir,
      args: ['diff', ...DIFF_FLAGS, '--unified', '--', BEFORE_NAME, AFTER_NAME],
      allowedExitCodes: ALLOWED_DIFF_EXITS,
    });
    return {
      additions: parsed.additions,
      deletions: parsed.deletions,
      binary: false,
      patch: rewritePatchPaths(unified.stdout, input.pathLabel),
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function readSide(store: TurnChangeObjectStore, sha: string | null): Promise<Uint8Array> {
  if (sha === null) {
    return new Uint8Array();
  }
  return store.get(sha);
}

/**
 * NUL-safe: first two tab fields are additions/deletions; path may contain NULs or `=>`.
 * Binary `-` stays null — do not reuse parseNumstat, which zeros those counts.
 */
function parseTurnChangeNumstat(stdout: string):
  | { binary: true }
  | { binary: false; additions: number; deletions: number } {
  if (stdout.length === 0) {
    return { binary: false, additions: 0, deletions: 0 };
  }
  const newline = stdout.indexOf('\n');
  const record = newline === -1 ? stdout : stdout.slice(0, newline);
  const firstTab = record.indexOf('\t');
  if (firstTab === -1) {
    return { binary: false, additions: 0, deletions: 0 };
  }
  const secondTab = record.indexOf('\t', firstTab + 1);
  if (secondTab === -1) {
    return { binary: false, additions: 0, deletions: 0 };
  }
  const additionsRaw = record.slice(0, firstTab);
  const deletionsRaw = record.slice(firstTab + 1, secondTab);
  if (additionsRaw === '-' || deletionsRaw === '-') {
    return { binary: true };
  }
  const additions = Number(additionsRaw);
  const deletions = Number(deletionsRaw);
  return {
    binary: false,
    additions: Number.isFinite(additions) ? additions : 0,
    deletions: Number.isFinite(deletions) ? deletions : 0,
  };
}

function rewritePatchPaths(patch: string, pathLabel: string): string {
  const label = pathLabel.replaceAll('\\', '/');
  return patch
    .split('\n')
    .map((line) => {
      if (line.startsWith('diff --git ')) {
        return `diff --git a/${label} b/${label}`;
      }
      if (line === `--- a/${BEFORE_NAME}`) {
        return `--- a/${label}`;
      }
      if (line === `+++ b/${AFTER_NAME}`) {
        return `+++ b/${label}`;
      }
      if (line.startsWith(`Binary files a/${BEFORE_NAME} and b/${AFTER_NAME}`)) {
        return `Binary files a/${label} and b/${label} differ`;
      }
      return line;
    })
    .join('\n');
}
