import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectExtensionEntryPaths } from './extension-scanner.js';
import {
  gitCloneRelativePath,
  loadPiNativeInventory,
  npmPackageName,
  parsePackagesField,
} from './pi-package-inventory.js';

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

describe('Pi package spec parsing', () => {
  it('accepts npm: prefix, unprefixed names, and scoped versions', () => {
    expect(npmPackageName('pi-build-ios-apps')).toBe('pi-build-ios-apps');
    expect(npmPackageName('pi-build-ios-apps@0.4.0')).toBe('pi-build-ios-apps');
    expect(npmPackageName('@org/ext@1.2.3')).toBe('@org/ext');
    expect(parsePackagesField(['npm:pi-build-ios-apps', 'pi-skills'])).toEqual([
      expect.objectContaining({ kind: 'npm', locator: 'pi-build-ios-apps' }),
      expect.objectContaining({ kind: 'npm', locator: 'pi-skills' }),
    ]);
  });

  it('parses git clone relative paths', () => {
    expect(gitCloneRelativePath('git:github.com/aa2246740/pi-build-ios-apps')).toBe(
      'github.com/aa2246740/pi-build-ios-apps',
    );
    expect(gitCloneRelativePath('https://github.com/user/repo.git')).toBe('github.com/user/repo');
    expect(gitCloneRelativePath('git:git@github.com:user/repo')).toBe('github.com/user/repo');
  });

  it('keeps object-form filters', () => {
    const parsed = parsePackagesField([
      { source: 'npm:my-package', skills: ['brave-search'], extensions: [] },
    ]);
    expect(parsed[0]).toMatchObject({
      kind: 'npm',
      locator: 'my-package',
      filter: { skills: ['brave-search'], extensions: [] },
    });
  });
});

describe('loadPiNativeInventory', () => {
  it('reads npm packages and loose agentDir resources', async () => {
    const agentDir = await mkdtemp(join(tmpdir(), 'pi-agent-'));
    const packageRoot = join(agentDir, 'npm', 'node_modules', 'pi-build-ios-apps');
    await mkdir(join(packageRoot, 'extensions'), { recursive: true });
    await mkdir(join(packageRoot, 'skills', 'pi-build-ios-apps'), { recursive: true });
    await writeJson(join(packageRoot, 'package.json'), {
      name: 'pi-build-ios-apps',
      version: '0.4.0',
      pi: { extensions: ['./extensions'], skills: ['./skills'] },
    });
    await writeFile(
      join(packageRoot, 'extensions', 'pi-build-ios-apps.ts'),
      '/** Develop React Native apps. */\nexport default function () {}\n',
      'utf8',
    );
    await writeFile(
      join(packageRoot, 'skills', 'pi-build-ios-apps', 'SKILL.md'),
      '---\nname: pi-build-ios-apps\ndescription: Browser-first RN loop\n---\nbody\n',
      'utf8',
    );
    await mkdir(join(agentDir, 'extensions'), { recursive: true });
    await writeFile(
      join(agentDir, 'extensions', 'deepseek-cache.ts'),
      'export default function () {}\n',
      'utf8',
    );
    await writeJson(join(agentDir, 'settings.json'), {
      packages: ['npm:pi-build-ios-apps'],
    });

    const inventory = await loadPiNativeInventory({ agentDir });
    expect(inventory.diagnostics).toEqual([]);
    expect(inventory.extensions.map((item) => item.id).sort()).toEqual([
      'deepseek-cache',
      'pi-build-ios-apps',
    ]);
    const packaged = inventory.extensions.find((item) => item.id === 'pi-build-ios-apps');
    expect(packaged?.source).toBe('pi-native');
    expect(packaged?.enabled).toBe(true);
    expect(packaged?.description).toContain('React Native');
    expect(inventory.skills.map((item) => item.id)).toEqual(['pi-build-ios-apps']);
    expect(inventory.skills[0]?.path).toContain(`${join('skills', 'pi-build-ios-apps')}`);
  });

  it('identifies same-named entries of different packages by package', async () => {
    const agentDir = await mkdtemp(join(tmpdir(), 'pi-agent-collide-'));
    const packages: Array<[string, string]> = [
      ['@gotgenes/pi-anthropic-auth', 'src/index.ts'],
      ['@amaster.ai/pi-computer-use', 'dist/index.js'],
    ];
    for (const [name, entry] of packages) {
      const packageRoot = join(agentDir, 'npm', 'node_modules', name);
      const entryPath = join(packageRoot, entry);
      await mkdir(dirname(entryPath), { recursive: true });
      await writeJson(join(packageRoot, 'package.json'), {
        name,
        pi: { extensions: [`./${entry}`] },
      });
      await writeFile(entryPath, 'export default function () {}\n', 'utf8');
    }
    await writeJson(join(agentDir, 'settings.json'), {
      packages: ['npm:@gotgenes/pi-anthropic-auth', 'npm:@amaster.ai/pi-computer-use'],
    });

    const inventory = await loadPiNativeInventory({ agentDir });
    expect(inventory.diagnostics).toEqual([]);
    expect(inventory.extensions.map((item) => item.id)).toEqual([
      'gotgenes-pi-anthropic-auth',
      'amaster-ai-pi-computer-use',
    ]);
    expect(inventory.extensions[1]?.name).toBe('@amaster.ai/pi-computer-use');

    // Regression: both entries used to share the id `index`, and the blueprint
    // collector dedupes by id, so the second package never reached Pi.
    const paths = collectExtensionEntryPaths({
      piwinRoot: agentDir,
      discovered: inventory.extensions,
    });
    expect(paths).toHaveLength(2);
    expect(paths.some((resourcePath) => resourcePath.endsWith(join('src', 'index.ts')))).toBe(true);
    expect(paths.some((resourcePath) => resourcePath.endsWith(join('dist', 'index.js')))).toBe(
      true,
    );
  });

  it('skips missing package roots without throwing', async () => {
    const agentDir = await mkdtemp(join(tmpdir(), 'pi-agent-missing-'));
    await writeJson(join(agentDir, 'settings.json'), {
      packages: ['npm:not-installed'],
    });
    const inventory = await loadPiNativeInventory({ agentDir });
    expect(inventory.extensions).toEqual([]);
    expect(inventory.diagnostics[0]?.code).toBe('unresolved');
  });

  it('honors object filters that disable extensions', async () => {
    const agentDir = await mkdtemp(join(tmpdir(), 'pi-agent-filter-'));
    const packageRoot = join(agentDir, 'npm', 'node_modules', 'my-package');
    await mkdir(join(packageRoot, 'extensions'), { recursive: true });
    await mkdir(join(packageRoot, 'skills', 'keep'), { recursive: true });
    await writeJson(join(packageRoot, 'package.json'), {
      name: 'my-package',
      pi: { extensions: ['./extensions'], skills: ['./skills'] },
    });
    await writeFile(join(packageRoot, 'extensions', 'gone.ts'), 'export default function () {}\n', 'utf8');
    await writeFile(
      join(packageRoot, 'skills', 'keep', 'SKILL.md'),
      '---\nname: keep\ndescription: keep\n---\n',
      'utf8',
    );
    await writeJson(join(agentDir, 'settings.json'), {
      packages: [{ source: 'npm:my-package', extensions: [], skills: ['skills'] }],
    });
    const inventory = await loadPiNativeInventory({ agentDir });
    expect(inventory.extensions).toEqual([]);
    expect(inventory.skills.map((item) => item.id)).toEqual(['keep']);
  });

  it('reads trusted project packages as source=project', async () => {
    const agentDir = await mkdtemp(join(tmpdir(), 'pi-agent-user-'));
    const projectPath = await mkdtemp(join(tmpdir(), 'pi-project-'));
    const packageRoot = join(projectPath, '.pi', 'npm', 'node_modules', 'proj-ext');
    await mkdir(join(packageRoot, 'extensions'), { recursive: true });
    await writeJson(join(packageRoot, 'package.json'), {
      name: 'proj-ext',
      pi: { extensions: ['./extensions'] },
    });
    await writeFile(join(packageRoot, 'extensions', 'proj-ext.ts'), 'export default function () {}\n', 'utf8');
    await mkdir(join(projectPath, '.pi'), { recursive: true });
    await writeJson(join(projectPath, '.pi', 'settings.json'), {
      packages: ['npm:proj-ext'],
    });
    await writeJson(join(agentDir, 'settings.json'), { packages: [] });

    const inventory = await loadPiNativeInventory({ agentDir, projectPath });
    expect(inventory.extensions.map((item) => item.id)).toEqual(['proj-ext']);
    expect(inventory.extensions[0]?.source).toBe('project');
  });

  it('treats invalid settings JSON as a diagnostic', async () => {
    const agentDir = await mkdtemp(join(tmpdir(), 'pi-agent-badjson-'));
    await writeFile(join(agentDir, 'settings.json'), '{not-json', 'utf8');
    const inventory = await loadPiNativeInventory({ agentDir });
    expect(inventory.diagnostics[0]?.code).toBe('invalid-settings');
    expect(inventory.extensions).toEqual([]);
  });
});
