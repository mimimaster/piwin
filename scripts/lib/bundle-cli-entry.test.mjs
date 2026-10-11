import { mkdtemp, mkdir, writeFile, readdir, readFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { bundleCliEntry } from './bundle-cli-entry.mjs';

test('packaged CLI defers unused external Host imports and ships sibling chunks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piwin-cli-bundle-'));
  const source = join(root, 'apps/cli/src');
  const outdir = join(root, 'dist-host');
  try {
    await mkdir(source, { recursive: true });
    await mkdir(join(outdir, 'node_modules/cold-host'), { recursive: true });
    await writeFile(
      join(source, 'index.ts'),
      "if (process.argv[2] === 'tui') { await import('./tui.js'); } else { await import('./host.js'); }",
    );
    await writeFile(join(source, 'tui.js'), "console.log('TUI ready');");
    await writeFile(join(source, 'host.js'), "import 'cold-host';");
    await writeFile(
      join(outdir, 'node_modules/cold-host/package.json'),
      JSON.stringify({ type: 'module', exports: './index.js' }),
    );
    await writeFile(
      join(outdir, 'node_modules/cold-host/index.js'),
      "throw new Error('Cold Host import evaluated');",
    );
    await bundleCliEntry({ root, outdir, external: ['cold-host'] });
    const tui = spawnSync(process.execPath, [join(outdir, 'host-serve.mjs'), 'tui'], {
      encoding: 'utf8',
    });
    assert.equal(tui.status, 0, tui.stderr);
    assert.match(tui.stdout, /TUI ready/);
    const host = spawnSync(process.execPath, [join(outdir, 'host-serve.mjs'), 'host'], {
      encoding: 'utf8',
    });
    assert.notEqual(host.status, 0);
    assert.match(host.stderr, /Cold Host import evaluated/);
    assert.ok((await readdir(outdir)).some((name) => /^cli-chunk-.*\.mjs$/.test(name)));
    const config = JSON.parse(
      await readFile(
        join(
          dirname(fileURLToPath(import.meta.url)),
          '../../apps/desktop/src-tauri/tauri.conf.sidecar.json',
        ),
        'utf8',
      ),
    );
    assert.equal(config.bundle.resources['../../../dist-host/cli-chunk-*.mjs'], 'host');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('fresh development checkout satisfies the lazy-chunk Tauri resource glob', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piwin-cli-placeholder-'));
  try {
    await mkdir(join(root, 'scripts'), { recursive: true });
    const binaries = join(root, 'apps/desktop/src-tauri/binaries');
    await mkdir(binaries, { recursive: true });
    await writeFile(join(binaries, 'piwin-host-fixture'), 'fixture');
    const script = join(root, 'scripts/ensure-packaging-placeholders.mjs');
    await copyFile(new URL('../ensure-packaging-placeholders.mjs', import.meta.url), script);
    const run = () => spawnSync(process.execPath, [script], { encoding: 'utf8' });
    const initial = run();
    assert.equal(initial.status, 0, initial.stderr);
    const chunks = join(root, 'dist-host');
    assert.ok((await readdir(chunks)).includes('cli-chunk-placeholder.mjs'));
    await rm(join(chunks, 'cli-chunk-placeholder.mjs'));
    await writeFile(join(chunks, 'cli-chunk-real.mjs'), 'export {};');
    const repeated = run();
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.equal((await readdir(chunks)).includes('cli-chunk-placeholder.mjs'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
