import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectExtensionEntryPaths, scanExtensions } from './extension-scanner.js';
import { ensureBundledExtensionsInstalled } from './ensure-bundled-extensions.js';
import { extensionIdFromPath } from './pi-resource-loader.js';

describe('extension-scanner', () => {
  it('scans user flat .ts and package index.ts', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-ext-scan-'));
    const extensionsDir = join(rootDir, 'extensions');
    await mkdir(extensionsDir, { recursive: true });
    await writeFile(
      join(extensionsDir, 'hello.ts'),
      '/** Greets the session. */\nexport default function () {}\n',
      'utf8',
    );
    await mkdir(join(extensionsDir, 'pack'), { recursive: true });
    await writeFile(
      join(extensionsDir, 'pack', 'index.ts'),
      'export default function () {}\n',
      'utf8',
    );

    const listed = await scanExtensions({ piwinRoot: rootDir });
    expect(listed.map((item) => item.id).sort()).toEqual(['hello', 'pack']);
    const hello = listed.find((item) => item.id === 'hello');
    expect(hello?.description).toContain('Greets');
    expect(hello?.enabled).toBe(true);
  });

  it('respects disabledIds and collects only enabled entry paths', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-ext-dis-'));
    const extensionsDir = join(rootDir, 'extensions');
    await mkdir(extensionsDir, { recursive: true });
    await writeFile(join(extensionsDir, 'keep.ts'), 'export default function () {}\n', 'utf8');
    await writeFile(join(extensionsDir, 'drop.ts'), 'export default function () {}\n', 'utf8');

    const listed = await scanExtensions({
      piwinRoot: rootDir,
      extensionsConfig: { extraPaths: [], disabledIds: ['drop'] },
    });
    expect(listed.find((item) => item.id === 'drop')?.enabled).toBe(false);
    expect(listed.find((item) => item.id === 'keep')?.enabled).toBe(true);

    const paths = collectExtensionEntryPaths({
      piwinRoot: rootDir,
      discovered: listed,
      disabledIds: ['drop'],
    });
    expect(paths.some((path) => path.endsWith('keep.ts'))).toBe(true);
    expect(paths.some((path) => path.endsWith('drop.ts'))).toBe(false);
  });

  it('lists TUI-only extensions as incompatible and omits them from entry paths', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-ext-tui-'));
    const extensionsDir = join(rootDir, 'extensions');
    await mkdir(extensionsDir, { recursive: true });
    await writeFile(
      join(extensionsDir, 'theme.ts'),
      'export default function () { ctx.ui.custom({}); }\n',
      'utf8',
    );
    await writeFile(
      join(extensionsDir, 'tools.ts'),
      "pi.on('tool_call', () => {});\nexport default function () {}\n",
      'utf8',
    );
    const listed = await scanExtensions({ piwinRoot: rootDir });
    expect(listed.find((item) => item.id === 'theme')?.compatibility?.tier).toBe('incompatible');
    expect(listed.find((item) => item.id === 'theme')?.enabled).toBe(false);
    expect(listed.find((item) => item.id === 'tools')?.compatibility?.tier).toBe('compatible');
    expect(listed.find((item) => item.id === 'tools')?.enabled).toBe(true);
    const paths = collectExtensionEntryPaths({ piwinRoot: rootDir, discovered: listed });
    expect(paths.some((path) => path.endsWith('theme.ts'))).toBe(false);
    expect(paths.some((path) => path.endsWith('tools.ts'))).toBe(true);
  });

  it('installs bundled extensions once and marks bundled sources', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-ext-bundled-'));
    const installed = await ensureBundledExtensionsInstalled(rootDir);
    expect(installed).toContain('path-guard');
    expect(installed).toContain('questionnaire');
    expect(installed).toContain('goal');
    expect(installed).toContain('pi-anthropic-auth');
    expect(installed).not.toContain('questionnaire.test');
    expect(installed).not.toContain('goal.test');
    const again = await ensureBundledExtensionsInstalled(rootDir);
    expect(again).toEqual([]);

    const listed = await scanExtensions({ piwinRoot: rootDir });
    const pathGuard = listed.find((item) => item.id === 'path-guard');
    expect(pathGuard).toBeDefined();
    expect(pathGuard?.source).toBe('bundled');
    expect(pathGuard?.description.toLowerCase()).toContain('secret');
    expect(pathGuard?.hookEvents).toEqual(['tool_call']);

    const questionnaire = listed.find((item) => item.id === 'questionnaire');
    expect(questionnaire).toBeDefined();
    expect(questionnaire?.source).toBe('bundled');
    expect(questionnaire?.description.toLowerCase()).toContain('question');

    const goal = listed.find((item) => item.id === 'goal');
    expect(goal).toBeDefined();
    expect(goal?.source).toBe('bundled');
    expect(goal?.description.toLowerCase()).toContain('goal');

    const anthropicAuth = listed.find((item) => item.id === 'pi-anthropic-auth');
    expect(anthropicAuth).toBeDefined();
    expect(anthropicAuth?.source).toBe('bundled');
    expect(anthropicAuth?.compatibility?.tier).toBe('compatible');
    expect(anthropicAuth?.enabled).toBe(true);

    expect(listed.find((item) => item.name === 'questionnaire.test')).toBeUndefined();
    expect(listed.find((item) => item.name === 'goal.test')).toBeUndefined();
  });
});

describe('extensionIdFromPath', () => {
  it('derives id from file and package index paths', () => {
    expect(extensionIdFromPath('/tmp/extensions/path-guard.ts')).toBe('path-guard');
    expect(extensionIdFromPath('/tmp/extensions/my-pack/index.ts')).toBe('my-pack');
  });
});

  it('marks package dirs with @piwin-bundled-extension as bundled', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-ext-bundled-'));
    const extensionsDir = join(rootDir, 'extensions');
    const pkg = join(extensionsDir, 'pi-deepseek-cache');
    await mkdir(pkg, { recursive: true });
    await writeFile(
      join(pkg, 'index.ts'),
      '/**\n * DeepSeek cache\n * @piwin-bundled-extension\n */\nexport default async function () {}\n',
      'utf8',
    );
    await writeFile(
      join(pkg, 'package.json'),
      JSON.stringify({
        name: 'pi-deepseek-cache',
        version: '1.0.4',
        piwin: { bundledFrom: 'npm:@rohaquinlop/pi-deepseek-cache', npmVersion: '1.0.4' },
      }),
      'utf8',
    );

    const listed = await scanExtensions({
      piwinRoot: rootDir,
      extensionsConfig: { disabledIds: [], extraPaths: [] },
    });
    const hit = listed.find((item) => item.id === 'pi-deepseek-cache');
    expect(hit?.source).toBe('bundled');
  });
