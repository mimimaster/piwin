import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDiscoveredResources } from './discovered-resources.js';
import { createPiResourceLoader } from './pi-resource-loader.js';

async function seedPiwinAndPi(): Promise<{ piwinRoot: string; agentDir: string }> {
  const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-root-'));
  const agentDir = await mkdtemp(join(tmpdir(), 'pi-agent-'));
  await mkdir(join(piwinRoot, 'extensions'), { recursive: true });
  await mkdir(join(piwinRoot, 'skills'), { recursive: true });
  await mkdir(join(piwinRoot, 'prompts'), { recursive: true });
  await writeFile(
    join(piwinRoot, 'extensions', 'hello.ts'),
    '/** User hello. */\nexport default function () {}\n',
    'utf8',
  );

  const packageRoot = join(agentDir, 'npm', 'node_modules', 'shared');
  await mkdir(join(packageRoot, 'extensions'), { recursive: true });
  await writeFile(
    join(packageRoot, 'package.json'),
    JSON.stringify({ name: 'shared', pi: { extensions: ['./extensions'] } }),
    'utf8',
  );
  await writeFile(join(packageRoot, 'extensions', 'hello.ts'), 'export default function () {}\n', 'utf8');
  await writeFile(
    join(agentDir, 'settings.json'),
    JSON.stringify({ packages: ['npm:shared'] }),
    'utf8',
  );
  return { piwinRoot, agentDir };
}

describe('loadDiscoveredResources', () => {
  it('unions piwin and Pi inventories and keeps both ids visible for shadowing', async () => {
    const { piwinRoot, agentDir } = await seedPiwinAndPi();
    const listed = await loadDiscoveredResources({ piwinRoot, agentDir });
    const hellos = listed.extensions.filter((item) => item.id === 'hello');
    expect(hellos.length).toBe(2);
    expect(hellos.map((item) => item.source)).toEqual(['user', 'pi-native']);
  });

  it('createPiResourceLoader uses the same union and only activates the winner path', async () => {
    const { piwinRoot, agentDir } = await seedPiwinAndPi();
    const loaded = await createPiResourceLoader({
      cwd: piwinRoot,
      agentDir,
      piwinRoot,
      scope: { kind: 'general' },
    });
    const hellos = loaded.resourceCatalog.entries.filter(
      (entry) => entry.kind === 'extension' && entry.resourceId === 'hello',
    );
    expect(hellos).toHaveLength(2);
    expect(loaded.resourceCatalog.diagnostics.some((item) => item.kind === 'shadowed')).toBe(true);
    expect(loaded.extensionPaths.some((path) => path.includes(join(piwinRoot, 'extensions')))).toBe(
      true,
    );
    expect(loaded.extensionPaths.some((path) => path.includes(join(agentDir, 'npm')))).toBe(false);
  });

  it('honors disabledIds for pi-native entries', async () => {
    const { piwinRoot, agentDir } = await seedPiwinAndPi();
    const listed = await loadDiscoveredResources({
      piwinRoot,
      agentDir,
      extensionsConfig: { extraPaths: [], disabledIds: ['hello'] },
    });
    const native = listed.extensions.find((item) => item.source === 'pi-native');
    expect(native?.enabled).toBe(false);
  });
});
