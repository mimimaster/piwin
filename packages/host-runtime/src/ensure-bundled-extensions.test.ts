import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureBundledExtensionsInstalled } from './ensure-bundled-extensions.js';

describe('ensureBundledExtensionsInstalled', () => {
  it('refreshes package dirs when npm fingerprint changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-bundled-ext-'));
    const bundled = join(root, 'bundled');
    const piwinRoot = join(root, 'piwin');
    const pkg = join(bundled, 'pi-anthropic-auth');
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, 'index.ts'), 'export default async function () {}');
    await writeFile(
      join(pkg, 'package.json'),
      JSON.stringify({
        name: '@gotgenes/pi-anthropic-auth',
        version: '2.0.8',
        piwin: { bundledFrom: 'npm:@gotgenes/pi-anthropic-auth', npmVersion: '2.0.8' },
      }),
    );

    const first = await ensureBundledExtensionsInstalled(piwinRoot, bundled);
    expect(first).toContain('pi-anthropic-auth');

    const targetPkg = join(piwinRoot, 'extensions', 'pi-anthropic-auth', 'package.json');
    expect(JSON.parse(await readFile(targetPkg, 'utf8')).version).toBe('2.0.8');

    // Same fingerprint → no reinstall
    const second = await ensureBundledExtensionsInstalled(piwinRoot, bundled);
    expect(second).toEqual([]);

    // Bump version → refresh
    await writeFile(
      join(pkg, 'package.json'),
      JSON.stringify({
        name: '@gotgenes/pi-anthropic-auth',
        version: '2.0.9',
        piwin: { bundledFrom: 'npm:@gotgenes/pi-anthropic-auth', npmVersion: '2.0.9' },
      }),
    );
    await writeFile(join(pkg, 'index.ts'), 'export default async function () { /* v2.0.9 */ }');
    const third = await ensureBundledExtensionsInstalled(piwinRoot, bundled);
    expect(third).toContain('pi-anthropic-auth');
    expect(JSON.parse(await readFile(targetPkg, 'utf8')).version).toBe('2.0.9');
  });
});
