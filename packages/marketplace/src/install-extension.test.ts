import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installExtension } from './install-extension.js';

describe('installExtension local', () => {
  it('copies a flat .ts extension module', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-ext-install-'));
    const srcDir = await mkdtemp(join(tmpdir(), 'piwin-ext-src-'));
    const srcFile = join(srcDir, 'hello.ts');
    await writeFile(srcFile, 'export default function () {}\n', 'utf8');

    const result = await installExtension({
      piwinRoot: root,
      source: { kind: 'local', path: srcFile },
    });
    expect(result.extensionId).toBe('hello');
    expect(result.targetPath).toContain(join(root, 'extensions', 'hello.ts'));
  });

  it('copies package-style index.ts directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-ext-pkg-'));
    const srcDir = join(await mkdtemp(join(tmpdir(), 'piwin-ext-pkg-src-')), 'mypack');
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, 'index.ts'), 'export default function () {}\n', 'utf8');

    const result = await installExtension({
      piwinRoot: root,
      source: { kind: 'local', path: srcDir },
    });
    expect(result.extensionId).toBe('mypack');
    expect(result.targetPath).toContain(join(root, 'extensions', 'mypack'));
  });
});
