#!/usr/bin/env node
/**
 * Desktop package pipeline with one signing identity for every step:
 * host Mach-O natives (sign-host-macho) and the .app / sidecar (tauri build)
 * both read APPLE_SIGNING_IDENTITY. When it is unset on macOS, a single
 * Developer ID Application identity in the keychain is used.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSigningIdentity } from './lib/signing-identity.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };

if (process.platform === 'darwin') {
  const resolved = resolveSigningIdentity({
    envIdentity: env.APPLE_SIGNING_IDENTITY,
    findIdentityOutput: () =>
      spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' })
        .stdout ?? '',
  });
  if (resolved.kind === 'ambiguous') {
    console.error(
      `[package-desktop] several Developer ID identities; set APPLE_SIGNING_IDENTITY to one of:\n  ${resolved.candidates.join('\n  ')}`,
    );
    process.exit(1);
  }
  if (resolved.kind === 'none') {
    console.warn(
      '[package-desktop] WARNING: no Developer ID identity; building ad-hoc. macOS will treat every build as a new app and re-prompt for Desktop / external-volume access.',
    );
  } else {
    env.APPLE_SIGNING_IDENTITY = resolved.identity;
    console.log(`[package-desktop] signing as ${resolved.identity} (from ${resolved.kind})`);
  }
}

const steps = [
  ['bundle:host'],
  ['fetch:node-runtime'],
  ['sign:host-macho'],
  ['--dir', 'apps/desktop', 'package', ...process.argv.slice(2)],
];
for (const args of steps) {
  const result = spawnSync('pnpm', args, { cwd: root, env, stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
