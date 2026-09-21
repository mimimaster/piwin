import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureBundledExtensionsInstalled } from './ensure-bundled-extensions.js';

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

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

  it('removes bundled modules that are no longer shipped', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-bundled-ext-unship-'));
    const bundled = join(root, 'bundled');
    const piwinRoot = join(root, 'piwin');
    const compactPkg = join(bundled, 'compact');
    await mkdir(compactPkg, { recursive: true });
    await writeFile(
      join(compactPkg, 'index.ts'),
      '/**\n * @piwin-bundled-extension\n */\nexport default async function () {}\n',
    );
    await writeFile(
      join(compactPkg, 'package.json'),
      JSON.stringify({
        name: 'compact',
        version: '1.1.0',
        piwin: { bundledFrom: 'piwin:compact', npmVersion: '1.1.0' },
      }),
    );
    await writeFile(
      join(bundled, 'path-guard.ts'),
      '/**\n * @piwin-bundled-extension\n */\nexport default async function () {}\n',
    );

    await ensureBundledExtensionsInstalled(piwinRoot, bundled);
    const extensionsDir = join(piwinRoot, 'extensions');
    expect(await exists(join(extensionsDir, 'compact', 'index.ts'))).toBe(true);
    expect(await exists(join(extensionsDir, 'path-guard.ts'))).toBe(true);

    await writeFile(join(extensionsDir, 'mine.ts'), 'export default function () {}\n');
    await writeFile(
      join(extensionsDir, 'compact.ts'),
      '/**\n * @piwin-bundled-extension\n */\nexport default async function () {}\n',
    );

    await rm(compactPkg, { recursive: true, force: true });
    const after = await ensureBundledExtensionsInstalled(piwinRoot, bundled);
    expect(after).toEqual([]);
    expect(await exists(join(extensionsDir, 'compact'))).toBe(false);
    expect(await exists(join(extensionsDir, 'compact.ts'))).toBe(false);
    expect(await exists(join(extensionsDir, 'path-guard.ts'))).toBe(true);
    expect(await exists(join(extensionsDir, 'mine.ts'))).toBe(true);
  });
});
