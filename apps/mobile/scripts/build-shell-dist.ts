/**
 * Assemble the mobile shell's front end: two interfaces in one bundle.
 *
 *   dist/            responsive workbench (apps/desktop, shell-only build) — default
 *   dist/classic/    the original phone interface (this package)
 *
 * Only build output is combined here; neither app imports the other's source.
 * The web entry page gets a boot script that hands off to classic when the
 * device is set to it (see @piwin/host-client shell-interface-mode).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { injectShellInterfaceBoot } from '@piwin/host-client';

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktopRoot = resolve(mobileRoot, '../desktop');
const distRoot = join(mobileRoot, 'dist');
const classicDist = join(distRoot, 'classic');

function run(cwd: string, args: string[], env: Record<string, string> = {}): void {
  const result = spawnSync('pnpm', args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    throw new Error(`pnpm ${args.join(' ')} failed in ${cwd} (exit ${String(result.status)})`);
  }
}

rmSync(distRoot, { recursive: true, force: true });

run(desktopRoot, ['exec', 'vite', 'build', '--outDir', distRoot, '--emptyOutDir'], {
  VITE_PIWIN_SHELL_ONLY: '1',
});
// The pet overlay is a Desktop-only window; the phone never opens it.
rmSync(join(distRoot, 'pet-overlay.html'), { force: true });

run(mobileRoot, ['exec', 'vite', 'build', '--base', '/classic/', '--outDir', classicDist]);

const webEntry = join(distRoot, 'index.html');
writeFileSync(webEntry, injectShellInterfaceBoot(readFileSync(webEntry, 'utf8')));

console.log(`mobile shell front end assembled at ${distRoot}`);
