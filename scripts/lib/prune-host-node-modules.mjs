/**
 * Safe production prune for dist-host/node_modules (ADR 0017 Phase-1 size cut).
 *
 * Only touches a packaging tree. Never run against the monorepo node_modules.
 *
 * Keep rules (do not delete):
 * - Pi package docs/ and examples/ (agent system prompt points here)
 * - CHANGELOG.md (Pi runtime may resolve it)
 * - Native clipboard package for the build triple (+ darwin-universal on macOS)
 * - Top-level @silvia-odwyer/photon-node WASM
 * - playwright-core, esbuild, provider SDK JS bodies
 */
import { lstat, readdir, rm, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

/**
 * @typedef {'sourcemap' | 'typedef' | 'markdown' | 'clipboard-foreign' | 'nested-photon-dup'} PruneCategory
 */

/**
 * @typedef {object} PruneReport
 * @property {number} removedBytes
 * @property {number} removedEntries
 * @property {Partial<Record<PruneCategory, number>>} byCategory
 * @property {string[]} samples
 */

/**
 * @typedef {object} PruneOptions
 * @property {NodeJS.Platform} [platform]
 * @property {string} [arch] Node arch: arm64 | x64 | …
 * @property {number} [maxSamples]
 * @property {(path: string) => void | Promise<void>} [remove] inject for tests
 */

/**
 * Map process.platform + process.arch → @mariozechner/clipboard-* package names to keep.
 * Always keep the JS meta package `clipboard`.
 *
 * @param {NodeJS.Platform} platform
 * @param {string} arch
 * @returns {Set<string>}
 */
export function clipboardPackagesToKeep(platform, arch) {
  const keep = new Set(['clipboard']);
  if (platform === 'darwin') {
    keep.add('clipboard-darwin-universal');
    if (arch === 'arm64') keep.add('clipboard-darwin-arm64');
    else keep.add('clipboard-darwin-x64');
    return keep;
  }
  if (platform === 'linux') {
    if (arch === 'arm64') {
      keep.add('clipboard-linux-arm64-gnu');
      keep.add('clipboard-linux-arm64-musl');
    } else if (arch === 'x64') {
      keep.add('clipboard-linux-x64-gnu');
      keep.add('clipboard-linux-x64-musl');
    } else if (arch === 'riscv64') {
      keep.add('clipboard-linux-riscv64-gnu');
    }
    return keep;
  }
  if (platform === 'win32') {
    if (arch === 'arm64') keep.add('clipboard-win32-arm64-msvc');
    else keep.add('clipboard-win32-x64-msvc');
    return keep;
  }
  return keep;
}

/**
 * @param {string} fileName
 * @returns {PruneCategory | null}
 */
export function classifyRemovableFile(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.map')) return 'sourcemap';
  if (
    lower.endsWith('.d.ts') ||
    lower.endsWith('.d.mts') ||
    lower.endsWith('.d.cts')
  ) {
    return 'typedef';
  }
  if (lower === 'changelog.md') return null;
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  return null;
}

/**
 * @param {string} nodeModulesRoot absolute path to dist-host/node_modules
 * @param {string} absolutePath
 * @returns {boolean}
 */
export function isUnderPiDocsOrExamples(nodeModulesRoot, absolutePath) {
  const rel = relative(nodeModulesRoot, absolutePath).split(sep).join('/');
  // @earendil-works/pi-coding-agent/docs/... or .../examples/...
  return (
    rel.startsWith('@earendil-works/pi-coding-agent/docs/') ||
    rel.startsWith('@earendil-works/pi-coding-agent/docs') ||
    rel.startsWith('@earendil-works/pi-coding-agent/examples/') ||
    rel.startsWith('@earendil-works/pi-coding-agent/examples') ||
    rel.includes('/pi-coding-agent/docs/') ||
    rel.includes('/pi-coding-agent/examples/')
  );
}

/**
 * @param {string} dir
 * @returns {AsyncGenerator<string>}
 */
async function* walkFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      yield full;
    }
  }
}

/**
 * @param {string} path
 * @returns {Promise<number>}
 */
async function safeSize(path) {
  try {
    const info = await lstat(path);
    if (info.isFile() || info.isSymbolicLink()) return info.size;
    if (!info.isDirectory()) return 0;
    let total = 0;
    for await (const file of walkFiles(path)) {
      try {
        total += (await lstat(file)).size;
      } catch {
        // ignore racing deletes
      }
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * @param {string} nodeModulesRoot
 * @returns {AsyncGenerator<string>} package roots named clipboard-* under @mariozechner
 */
async function* findMarioClipboardPackageRoots(nodeModulesRoot) {
  const stack = [nodeModulesRoot];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = join(dir, entry.name);
      if (entry.name === 'node_modules' || entry.name.startsWith('@')) {
        stack.push(full);
        continue;
      }
      // .../node_modules/@mariozechner/clipboard-foo
      if (entry.name.startsWith('clipboard')) {
        const parentName = dir.split(sep).pop();
        if (parentName === '@mariozechner') {
          yield full;
        }
      }
      // still recurse in case of nested structures
      if (entry.name !== 'clipboard' && !entry.name.startsWith('clipboard-')) {
        stack.push(full);
      } else if (entry.name === 'clipboard') {
        // JS package may contain nested dirs; no need to treat as foreign package root
      }
    }
  }
}

/**
 * Prune dist-host/node_modules in place.
 *
 * @param {string} nodeModulesRoot
 * @param {PruneOptions} [options]
 * @returns {Promise<PruneReport>}
 */
export async function pruneHostNodeModules(nodeModulesRoot, options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const maxSamples = options.maxSamples ?? 12;
  const remove =
    options.remove ??
    (async (path) => {
      await rm(path, { recursive: true, force: true });
    });

  /** @type {PruneReport} */
  const report = {
    removedBytes: 0,
    removedEntries: 0,
    byCategory: {},
    samples: [],
  };

  /**
   * @param {string} path
   * @param {PruneCategory} category
   */
  async function removePath(path, category) {
    const bytes = await safeSize(path);
    try {
      await remove(path);
    } catch {
      return;
    }
    report.removedBytes += bytes;
    report.removedEntries += 1;
    report.byCategory[category] = (report.byCategory[category] ?? 0) + bytes;
    if (report.samples.length < maxSamples) {
      report.samples.push(`${category}: ${relative(nodeModulesRoot, path)}`);
    }
  }

  // 1) File-level: maps, typedefs, markdown (skip Pi docs/examples trees for md)
  for await (const filePath of walkFiles(nodeModulesRoot)) {
    const base = filePath.split(sep).pop() ?? '';
    const category = classifyRemovableFile(base);
    if (!category) continue;
    if (category === 'markdown' && isUnderPiDocsOrExamples(nodeModulesRoot, filePath)) {
      continue;
    }
    await removePath(filePath, category);
  }

  // 2) Foreign clipboard native packages
  const keepClipboard = clipboardPackagesToKeep(platform, arch);
  for await (const pkgRoot of findMarioClipboardPackageRoots(nodeModulesRoot)) {
    const name = pkgRoot.split(sep).pop() ?? '';
    if (keepClipboard.has(name)) continue;
    await removePath(pkgRoot, 'clipboard-foreign');
  }

  // 3) Nested duplicate photon under pi-coding-agent when top-level exists
  const topPhoton = join(nodeModulesRoot, '@silvia-odwyer', 'photon-node');
  const nestedPhoton = join(
    nodeModulesRoot,
    '@earendil-works',
    'pi-coding-agent',
    'node_modules',
    '@silvia-odwyer',
    'photon-node',
  );
  try {
    await stat(topPhoton);
    try {
      await stat(nestedPhoton);
      await removePath(nestedPhoton, 'nested-photon-dup');
    } catch {
      // nested missing — ok
    }
  } catch {
    // top-level missing — keep nested if present
  }

  return report;
}

/**
 * @param {PruneReport} report
 * @returns {string}
 */
export function formatPruneReport(report) {
  const mb = (n) => `${(n / (1024 * 1024)).toFixed(2)} MB`;
  const lines = [
    `[prune-host] removed ${report.removedEntries} entries, ${mb(report.removedBytes)}`,
  ];
  const cats = Object.entries(report.byCategory).sort((a, b) => b[1] - a[1]);
  for (const [cat, bytes] of cats) {
    lines.push(`  - ${cat}: ${mb(bytes)}`);
  }
  if (report.samples.length > 0) {
    lines.push('  samples:');
    for (const sample of report.samples) {
      lines.push(`    ${sample}`);
    }
  }
  return lines.join('\n');
}
