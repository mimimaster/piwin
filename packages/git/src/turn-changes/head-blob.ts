/**
 * What `HEAD` holds for a set of working-tree paths, as bytes.
 *
 * A shell command can change a file Host never saw before it ran. When that
 * file was clean (absent from `git status`), its bytes before the command are
 * exactly its `HEAD` blob — unless a content filter (eol conversion, LFS,
 * `ident`) makes the working file differ from the blob while still reading as
 * clean. Those paths are reported so callers can refuse to trust `HEAD` for
 * them instead of restoring the wrong bytes.
 *
 * Paths are relative to `cwd` (the session root, possibly a repository
 * subdirectory), `/`-separated, and matched literally.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { runGitCommand } from '../git-command-runner.js';
import { gitExecOptions } from '../git-process-options.js';

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 15_000;
/** Paths per git invocation; keeps argv well under platform limits. */
const PATHS_PER_CALL = 200;
const BLOBS_IN_FLIGHT = 8;
const REGULAR_FILE_MODES = new Set(['100644', '100755']);

export type HeadFileLookup = {
  /** Regular files in HEAD, with their blob bytes. */
  found: Map<string, Uint8Array>;
  /** Paths HEAD has no entry for (or there is no HEAD): they did not exist there. */
  absent: Set<string>;
  /** In HEAD but not restorable as bytes (directory, symlink, submodule, too large, unreadable). */
  unsupported: Set<string>;
};

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/** `<mode> <type> <oid>\t<path>` entries of `ls-tree -z`. */
function parseLsTree(stdout: string): Map<string, { mode: string; type: string; oid: string }> {
  const entries = new Map<string, { mode: string; type: string; oid: string }>();
  for (const record of stdout.split('\0')) {
    const tab = record.indexOf('\t');
    if (tab < 0) continue;
    const [mode, type, oid] = record.slice(0, tab).split(' ');
    if (mode === undefined || type === undefined || oid === undefined) continue;
    entries.set(record.slice(tab + 1), { mode, type, oid });
  }
  return entries;
}

async function catBlob(cwd: string, oid: string, maxBytes: number): Promise<Uint8Array | null> {
  try {
    const { stdout } = await execFileAsync('git', ['cat-file', 'blob', oid], {
      ...gitExecOptions({ cwd, maxBuffer: maxBytes, timeout: GIT_TIMEOUT_MS }),
      encoding: 'buffer' as const,
    });
    return new Uint8Array(stdout);
  } catch {
    // Larger than maxBytes, or the object vanished: not restorable from here.
    return null;
  }
}

export async function readHeadFiles(input: {
  cwd: string;
  relativePaths: readonly string[];
  /** Blobs above this are `unsupported`; matches the object store's per-object cap. */
  maxBytes: number;
}): Promise<HeadFileLookup> {
  const lookup: HeadFileLookup = { found: new Map(), absent: new Set(), unsupported: new Set() };
  const wanted = [...new Set(input.relativePaths)];
  const tree = new Map<string, { mode: string; type: string; oid: string }>();
  for (const paths of chunk(wanted, PATHS_PER_CALL)) {
    const result = await runGitCommand({
      cwd: input.cwd,
      args: ['--literal-pathspecs', 'ls-tree', '-z', 'HEAD', '--', ...paths],
      timeoutMs: GIT_TIMEOUT_MS,
      allowFailure: true,
      env: { GIT_OPTIONAL_LOCKS: '0' },
    });
    if (result.exitCode !== 0) {
      // No commits yet: nothing was ever in HEAD.
      continue;
    }
    for (const [path, entry] of parseLsTree(result.stdout)) {
      tree.set(path, entry);
    }
  }

  const blobs: Array<{ path: string; oid: string }> = [];
  for (const path of wanted) {
    const entry = tree.get(path);
    if (entry === undefined) {
      lookup.absent.add(path);
    } else if (entry.type === 'blob' && REGULAR_FILE_MODES.has(entry.mode)) {
      blobs.push({ path, oid: entry.oid });
    } else {
      lookup.unsupported.add(path);
    }
  }
  for (const group of chunk(blobs, BLOBS_IN_FLIGHT)) {
    const bytes = await Promise.all(group.map((blob) => catBlob(input.cwd, blob.oid, input.maxBytes)));
    group.forEach((blob, index) => {
      const content = bytes[index];
      if (content === null || content === undefined) {
        lookup.unsupported.add(blob.path);
      } else {
        lookup.found.set(blob.path, content);
      }
    });
  }
  return lookup;
}

/** `git check-attr -z` records: path, attribute, value, repeated. */
function parseCheckAttr(stdout: string): Map<string, Map<string, string>> {
  const byPath = new Map<string, Map<string, string>>();
  const fields = stdout.split('\0');
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const path = fields[index];
    const attribute = fields[index + 1];
    const value = fields[index + 2];
    if (path === undefined || attribute === undefined || value === undefined) continue;
    let attributes = byPath.get(path);
    if (!attributes) {
      attributes = new Map();
      byPath.set(path, attributes);
    }
    attributes.set(attribute, value);
  }
  return byPath;
}

/**
 * Paths whose working-tree bytes may differ from their HEAD blob although git
 * calls them clean. `'all'` when a repository-wide conversion is configured.
 */
export async function findContentFilteredPaths(input: {
  cwd: string;
  relativePaths: readonly string[];
}): Promise<Set<string> | 'all'> {
  const config = await runGitCommand({
    cwd: input.cwd,
    args: ['config', '--get-regexp', '^core\\.(autocrlf|eol)$'],
    timeoutMs: GIT_TIMEOUT_MS,
    allowFailure: true,
    env: { GIT_OPTIONAL_LOCKS: '0' },
  });
  if (config.exitCode === 0) {
    for (const line of config.stdout.split('\n')) {
      const [key, value] = line.trim().split(/\s+/);
      const setting = value?.toLowerCase();
      if (key === 'core.autocrlf' && (setting === 'true' || setting === 'input')) return 'all';
      if (key === 'core.eol' && (setting === 'crlf' || setting === 'lf')) return 'all';
    }
  }
  const filtered = new Set<string>();
  for (const paths of chunk([...new Set(input.relativePaths)], PATHS_PER_CALL)) {
    const result = await runGitCommand({
      cwd: input.cwd,
      args: ['check-attr', '-z', 'filter', 'eol', 'ident', '--', ...paths],
      timeoutMs: GIT_TIMEOUT_MS,
      allowFailure: true,
      env: { GIT_OPTIONAL_LOCKS: '0' },
    });
    if (result.exitCode !== 0) {
      // Cannot tell: treat every path in this group as unsafe.
      for (const path of paths) filtered.add(path);
      continue;
    }
    for (const [path, attributes] of parseCheckAttr(result.stdout)) {
      for (const value of attributes.values()) {
        if (value !== 'unspecified' && value !== 'unset') {
          filtered.add(path);
          break;
        }
      }
    }
  }
  return filtered;
}
