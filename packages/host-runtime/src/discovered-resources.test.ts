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
  await mkdir(join(agentDir, 'extensions'), { recursive: true });
  // Loose Pi-native entry that collides with the user `hello.ts` by filename,
  // which is what source precedence (shadowing) is for.
  await writeFile(
    join(agentDir, 'extensions', 'hello.ts'),
    'export default function () {}\n',
    'utf8',
  );
  await writeFile(
    join(agentDir, 'extensions', 'tui-only.ts'),
    'ctx.ui.custom({});\nregisterTheme();\n',
    'utf8',
  );
  await writeFile(
    join(agentDir, 'extensions', 'mixed-agent.ts'),
    "pi.registerTool({ name: 'agent_tool' });\nctx.ui.setStatus('mixed', 'ready');\n",
    'utf8',
  );
  return { piwinRoot, agentDir };
}

describe('loadDiscoveredResources', () => {
  it('unions piwin and Pi inventories and keeps both ids visible for shadowing', async () => {
    const { piwinRoot, agentDir } = await seedPiwinAndPi();
    const listed = await loadDiscoveredResources({
      piwinRoot,
      agentDir,
      followPiNativeInventory: true,
    });
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
      followPiNativeInventory: true,
    });
    const hellos = loaded.resourceCatalog.entries.filter(
      (entry) => entry.kind === 'extension' && entry.resourceId === 'hello',
    );
    expect(hellos).toHaveLength(2);
    expect(loaded.resourceCatalog.diagnostics.some((item) => item.kind === 'shadowed')).toBe(true);
    expect(loaded.extensionPaths.some((path) => path.includes(join(piwinRoot, 'extensions')))).toBe(
      true,
    );
    // The user entry wins the `hello` collision; the loose pi-native copy loses.
    expect(loaded.extensionPaths).not.toContain(join(agentDir, 'extensions', 'hello.ts'));
    // The packaged extension carries a package-scoped id, so it is not
    // collateral damage in that collision.
    expect(loaded.extensionPaths.some((path) => path.includes(join(agentDir, 'npm')))).toBe(true);
  });

  it('honors disabledIds for pi-native entries', async () => {
    const { piwinRoot, agentDir } = await seedPiwinAndPi();
    const listed = await loadDiscoveredResources({
      piwinRoot,
      agentDir,
      followPiNativeInventory: true,
      extensionsConfig: { extraPaths: [], disabledIds: ['hello'] },
    });
    const native = listed.extensions.find((item) => item.source === 'pi-native' && item.id === 'hello');
    expect(native?.enabled).toBe(false);
  });

  it('lists TUI-only pi-native extensions as disabled and omits them from Blueprint paths', async () => {
    const { piwinRoot, agentDir } = await seedPiwinAndPi();
    const listed = await loadDiscoveredResources({
      piwinRoot,
      agentDir,
      followPiNativeInventory: true,
    });
    const tui = listed.extensions.find((item) => item.id === 'tui-only');
    expect(tui?.compatibility?.tier).toBe('incompatible');
    expect(tui?.enabled).toBe(false);
    const loaded = await createPiResourceLoader({
      cwd: piwinRoot,
      agentDir,
      piwinRoot,
      scope: { kind: 'general' },
      followPiNativeInventory: true,
    });
    expect(loaded.extensionPaths.some((path) => path.includes('tui-only'))).toBe(false);
  });

  it('keeps Agent tools active when only their auxiliary TUI surface is degraded', async () => {
    const { piwinRoot, agentDir } = await seedPiwinAndPi();
    const listed = await loadDiscoveredResources({
      piwinRoot,
      agentDir,
      followPiNativeInventory: true,
    });
    const mixed = listed.extensions.find((item) => item.id === 'mixed-agent');
    expect(mixed?.compatibility?.tier).toBe('degraded');
    expect(mixed?.enabled).toBe(true);

    const loaded = await createPiResourceLoader({
      cwd: piwinRoot,
      agentDir,
      piwinRoot,
      scope: { kind: 'general' },
      followPiNativeInventory: true,
    });
    expect(loaded.extensionPaths).toContain(join(agentDir, 'extensions', 'mixed-agent.ts'));
  });

  it('classifies a seeded product skill as bundled and a custom skill as user', async () => {
    const { piwinRoot, agentDir } = await seedPiwinAndPi();
    const productDir = join(piwinRoot, 'skills', 'find-skill');
    await mkdir(productDir, { recursive: true });
    await writeFile(
      join(productDir, 'SKILL.md'),
      '---\nname: find-skill\ndescription: Find a skill\n---\n# Find\n',
      'utf8',
    );
    const customDir = join(piwinRoot, 'skills', 'my-notes');
    await mkdir(customDir, { recursive: true });
    await writeFile(
      join(customDir, 'SKILL.md'),
      '---\nname: my-notes\ndescription: Personal\n---\n# Notes\n',
      'utf8',
    );
    const listed = await loadDiscoveredResources({
      piwinRoot,
      agentDir,
      followPiNativeInventory: false,
    });
    const findSkill = listed.skills.find((skill) => skill.id === 'find-skill');
    expect(findSkill?.source).toBe('bundled');
    expect(findSkill?.path).not.toBe(productDir);
    expect(listed.skills.find((skill) => skill.id === 'my-notes')?.source).toBe('user');
  });

  it('does not follow user-global Pi inventory for a custom piwinRoot', async () => {
    const { piwinRoot, agentDir } = await seedPiwinAndPi();
    const listed = await loadDiscoveredResources({
      piwinRoot,
      agentDir,
    });
    expect(listed.extensions.some((item) => item.source === 'pi-native')).toBe(false);
    expect(listed.extensions.some((item) => item.id === 'tui-only')).toBe(false);
  });
});
