import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installPlugin } from './install-plugin.js';
import { loadInstalledPlugins } from './plugin-store.js';

async function makePluginDir(parent: string): Promise<string> {
  const pluginDir = join(parent, 'my-plugin');
  await mkdir(join(pluginDir, 'skills', 'foo'), { recursive: true });
  await writeFile(
    join(pluginDir, 'plugin.json'),
    JSON.stringify({
      id: 'my-plugin',
      version: '1.0.0',
      name: 'My Plugin',
      skills: ['skills/foo'],
      mcpServers: {
        'my-server': {
          command: 'npx',
          args: ['-y', '@example/server'],
          env: { API_KEY: '${API_KEY}' },
        },
      },
      secrets: [{ name: 'API_KEY', required: true }],
    }),
    'utf8',
  );
  await writeFile(
    join(pluginDir, 'skills', 'foo', 'SKILL.md'),
    '---\nname: foo\ndescription: test\n---\n\n# Foo\n',
    'utf8',
  );
  return pluginDir;
}

describe('installPlugin (local)', () => {
  it('installs skills, merges MCP, writes secrets, persists state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-install-'));
    const sourceParent = await mkdtemp(join(tmpdir(), 'piwin-src-'));
    const pluginDir = await makePluginDir(sourceParent);

    const writtenSecrets: Record<string, string> = {};
    const mergedServers: Record<string, unknown> = {};

    try {
      const result = await installPlugin({
        piwinRoot: root,
        source: { kind: 'local', path: pluginDir },
        secrets: { API_KEY: 'sk-test-123' },
        writeSecret: async (ref, value) => {
          writtenSecrets[ref] = value;
        },
        mergeMcpServer: async (serverId, config) => {
          mergedServers[serverId] = config;
        },
      });

      expect(result.pluginId).toBe('my-plugin');
      expect(result.installedSkills).toEqual(['foo']);
      expect(result.mcpServerIds).toEqual(['plugin__my-plugin__my-server']);
      expect(result.secretRefs).toEqual(['API_KEY']);

      // Secret was written to keychain with namespaced ref.
      expect(writtenSecrets['keychain:piwin-plugin-my-plugin-API_KEY']).toBe('sk-test-123');

      // MCP server was merged with resolved env.
      const merged = mergedServers['plugin__my-plugin__my-server'] as {
        command: string;
        env: Record<string, string>;
      };
      expect(merged.command).toBe('npx');
      expect(merged.env.API_KEY).toBe('sk-test-123');

      // Skill was copied into skills root.
      const skillFile = await readFile(join(root, 'skills', 'foo', 'SKILL.md'), 'utf8');
      expect(skillFile).toContain('name: foo');

      // Installed state was persisted.
      const installed = await loadInstalledPlugins(root);
      expect(installed).toHaveLength(1);
      expect(installed[0]?.id).toBe('my-plugin');
      expect(installed[0]?.skills).toEqual(['foo']);
      expect(installed[0]?.mcpServerIds).toEqual(['plugin__my-plugin__my-server']);
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
      await rm(sourceParent, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('throws on missing required secret', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-install-'));
    const sourceParent = await mkdtemp(join(tmpdir(), 'piwin-src-'));
    const pluginDir = await makePluginDir(sourceParent);

    try {
      await expect(
        installPlugin({
          piwinRoot: root,
          source: { kind: 'local', path: pluginDir },
          writeSecret: async () => undefined,
          mergeMcpServer: async () => undefined,
        }),
      ).rejects.toThrow('Required secret "API_KEY"');
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
      await rm(sourceParent, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('throws on missing plugin.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-install-'));
    const emptyDir = await mkdtemp(join(tmpdir(), 'piwin-empty-'));

    try {
      await expect(
        installPlugin({
          piwinRoot: root,
          source: { kind: 'local', path: emptyDir },
        }),
      ).rejects.toThrow('plugin.json');
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
      await rm(emptyDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('throws on registry source without resolver', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-install-'));
    try {
      await expect(
        installPlugin({
          piwinRoot: root,
          source: { kind: 'registry', registryId: 'some-plugin' },
        }),
      ).rejects.toThrow('resolveRegistrySource');
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('installs bundled Cloudflare without a remote registry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-install-'));
    const mergedServers: Record<string, { command: string; args?: string[] }> = {};
    try {
      const result = await installPlugin({
        piwinRoot: root,
        source: { kind: 'bundled', bundledId: 'cloudflare' },
        mergeMcpServer: async (serverId, config) => {
          mergedServers[serverId] = config;
        },
      });
      expect(result.pluginId).toBe('cloudflare');
      expect(result.mcpServerIds).toEqual([
        'plugin__cloudflare__api',
        'plugin__cloudflare__docs',
      ]);
      expect(mergedServers['plugin__cloudflare__api']?.args).toEqual([
        '-y',
        'mcp-remote',
        'https://mcp.cloudflare.com/mcp',
      ]);
      const installed = await loadInstalledPlugins(root);
      expect(installed[0]?.source).toEqual({ kind: 'bundled', bundledId: 'cloudflare' });
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('maps registry id cloudflare to the bundled plugin', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-install-'));
    try {
      const result = await installPlugin({
        piwinRoot: root,
        source: { kind: 'registry', registryId: 'cloudflare' },
      });
      expect(result.pluginId).toBe('cloudflare');
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('resolves the GitHub PAT into mcp-remote args', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-install-'));
    const mergedServers: Record<string, { args?: string[]; env?: Record<string, string> }> = {};
    try {
      await expect(
        installPlugin({
          piwinRoot: root,
          source: { kind: 'bundled', bundledId: 'github' },
        }),
      ).rejects.toThrow('GITHUB_PERSONAL_ACCESS_TOKEN');

      const result = await installPlugin({
        piwinRoot: root,
        source: { kind: 'bundled', bundledId: 'github' },
        secrets: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_test' },
        mergeMcpServer: async (serverId, config) => {
          mergedServers[serverId] = config;
        },
      });
      expect(result.pluginId).toBe('github');
      expect(mergedServers['plugin__github__github']?.args).toContain(
        'Authorization: Bearer ghp_test',
      );
      expect(mergedServers['plugin__github__github']?.env).toEqual({
        GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_test',
      });
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('installs bundled Figma and HyperFrames without secrets', async () => {
    for (const bundledId of ['figma', 'hyperframes'] as const) {
      const root = await mkdtemp(join(tmpdir(), 'piwin-install-'));
      const mergedServers: Record<string, { command: string; args?: string[] }> = {};
      try {
        const result = await installPlugin({
          piwinRoot: root,
          source: { kind: 'bundled', bundledId },
          mergeMcpServer: async (serverId, config) => {
            mergedServers[serverId] = config;
          },
        });
        expect(result.pluginId).toBe(bundledId);
        expect(result.mcpServerIds).toEqual([`plugin__${bundledId}__${bundledId}`]);
        expect(mergedServers[`plugin__${bundledId}__${bundledId}`]?.args?.[1]).toBe('mcp-remote');
      } finally {
        await rm(root, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  });
});
