#!/usr/bin/env node
/**
 * Rewrite apps/desktop/src-tauri/tauri.conf.json "version" for CI/tag builds.
 * Does not commit. Tag `v0.1.0` and input `0.1.0` both become 0.1.0.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeDesktopPackageVersion,
  replaceDesktopConfigVersion,
} from './lib/desktop-package-version.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = join(root, 'apps/desktop/src-tauri/tauri.conf.json');

async function main() {
  const version = normalizeDesktopPackageVersion(process.argv[2]);
  const source = await readFile(configPath, 'utf8');
  const next = replaceDesktopConfigVersion(source, version);
  await writeFile(configPath, next);
  console.log(`[apply-desktop-version] ${configPath} -> ${version}`);
}

main().catch((error) => {
  console.error('[apply-desktop-version] failed:', error);
  process.exit(1);
});
