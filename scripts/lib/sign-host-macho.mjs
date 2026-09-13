/**
 * Find and Developer-ID-sign Mach-O files in the packaged Host tree.
 * Tauri signs the .app and sidecar binary, but not resource natives
 * (lancedb / sharp / esbuild / onnx). Apple notarization rejects those.
 */
import { open, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Big-endian Mach-O / fat magics (also match byte-swapped via the set). */
const MACHO_MAGICS = new Set([
  0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca,
  0xcafebabf, 0xbfbafeca,
]);

/**
 * @param {Buffer} header first 4+ bytes
 * @returns {boolean}
 */
export function isMachOMagic(header) {
  if (header.length < 4) return false;
  return MACHO_MAGICS.has(header.readUInt32BE(0));
}

/**
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
export async function fileIsMachO(filePath) {
  let handle;
  try {
    handle = await open(filePath, 'r');
    const header = Buffer.alloc(4);
    const { bytesRead } = await handle.read(header, 0, 4, 0);
    return bytesRead === 4 && isMachOMagic(header);
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

/**
 * Regular files only — sign symlink targets, not the links (.bin wrappers).
 *
 * @param {string} root
 * @returns {Promise<string[]>}
 */
export async function collectMachOFiles(root) {
  /** @type {string[]} */
  const found = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (await fileIsMachO(full)) found.push(full);
    }
  }

  await walk(root);
  return found;
}

/**
 * @param {{ identity: string, entitlements?: string, file: string }} input
 * @returns {string[]}
 */
export function buildCodesignArgs(input) {
  const args = [
    '--force',
    '--options',
    'runtime',
    '--timestamp',
    '--sign',
    input.identity,
  ];
  if (input.entitlements) {
    args.push('--entitlements', input.entitlements);
  }
  args.push(input.file);
  return args;
}
