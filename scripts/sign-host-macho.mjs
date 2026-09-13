#!/usr/bin/env node
/**
 * Sign Mach-O natives in dist-host before `tauri build` copies them as resources.
 * No-op when APPLE_SIGNING_IDENTITY is unset (unsigned local packages).
 */
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { collectMachOFiles, buildCodesignArgs } from './lib/sign-host-macho.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distHost = join(root, 'dist-host');

async function main() {
  if (process.platform !== 'darwin') {
    console.log('[sign-host-macho] skip: not macOS');
    return;
  }
  const identity = process.env.APPLE_SIGNING_IDENTITY?.trim();
  if (!identity) {
    console.log('[sign-host-macho] skip: APPLE_SIGNING_IDENTITY unset');
    return;
  }

  const paths = await collectMachOFiles(distHost);
  console.log(`[sign-host-macho] signing ${paths.length} Mach-O files as ${identity}`);
  for (const file of paths) {
    const args = buildCodesignArgs({ identity, file });
    const result = spawnSync('codesign', args, { stdio: 'inherit' });
    if (result.status !== 0) {
      throw new Error(`codesign failed for ${relative(root, file)}`);
    }
  }
  console.log('[sign-host-macho] done');
}

main().catch((error) => {
  console.error('[sign-host-macho] failed:', error);
  process.exit(1);
});
