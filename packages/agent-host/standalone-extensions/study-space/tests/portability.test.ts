import { readFile, readdir, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
describe('standalone source contract', () => {
  it('package contains no runtime dependencies, install scripts or parent configuration', async () => {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    expect(pkg.dependencies).toBeUndefined(); expect(pkg.optionalDependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
    for (const script of ['preinstall', 'install', 'postinstall']) expect(pkg.scripts[script]).toBeUndefined();
    expect(pkg.devDependencies['@earendil-works/pi-coding-agent']).toBe('0.84.2');
    expect(pkg.devDependencies.typebox).toBe('1.1.38');
    expect(pkg.pi.extensions).toEqual(['./index.ts']);
    expect(JSON.parse(await readFile(join(root, 'tsconfig.json'), 'utf8')).extends).toBeUndefined();
    expect(pkg.files).toEqual(['index.ts', 'model.ts', 'store.ts', 'prompt.ts', 'status.ts', 'local.ts', 'native.ts', 'README.md', 'LICENSE', 'NOTICE']);
    for (const document of ['LICENSE', 'NOTICE']) expect((await readFile(join(root, document), 'utf8')).length).toBeGreaterThan(100);
    for (const forbidden of ['vendor', 'pnpm-lock.yaml', 'package-lock.json', 'AGENTS.md']) expect(await readdir(root)).not.toContain(forbidden);
  });
  it('production imports only own files, Node stdlib, supplied Typebox and type-only Pi', async () => {
    const files = (await readdir(root)).filter(file => file.endsWith('.ts') && file !== 'vitest.config.ts');
    expect(files).toContain('index.ts');
    for (const file of files) {
      expect((await lstat(join(root, file))).isSymbolicLink()).toBe(false);
      const source = await readFile(join(root, file), 'utf8');
      expect(source.split('\n').length).toBeLessThan(400);
      for (const match of source.matchAll(/import\s+(type\s+)?[\s\S]*?from\s+['"]([^'"]+)['"]/g)) {
        const specifier = match[2]!;
        expect(specifier.startsWith('./') || specifier.startsWith('node:') || specifier === 'typebox' || (Boolean(match[1]) && specifier === '@earendil-works/pi-coding-agent')).toBe(true);
      }
      expect(source).not.toMatch(/pi\.(exec|setActiveTools|appendEntry)\s*\(/);
      expect(source).not.toMatch(/(?:callTool|executeTool|fetch)\s*\(/);
    }
  });
});
