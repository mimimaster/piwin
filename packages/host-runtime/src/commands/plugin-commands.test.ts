import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostPush } from '@piwin/contracts';
import { loadMcpConfig } from '@piwin/mcp';
import { loadInstalledPlugins } from '@piwin/marketplace';

// Mock secret-resolver so tests don't touch the real keychain.
const mockKeychain = new Map<string, string>();
vi.mock('../secret-resolver.js', () => ({
  createSecretResolver: () => ({
    resolveProviderSecret: () => Promise.resolve(''),
    reportProviderSecret: () => Promise.resolve({ providerId: '', status: 'ok' as const }),
    writeProviderSecret: () => Promise.resolve(''),
    readProviderSecret: () => Promise.resolve(null),
    writeSecretByRef: (ref: string, value: string) => {
      mockKeychain.set(ref, value);
      return Promise.resolve();
    },
    readSecretByRef: (ref: string) => Promise.resolve(mockKeychain.get(ref) ?? null),
    deleteProviderSecret: (providerId: string) => {
      mockKeychain.delete(`keychain:piwin-${providerId}`);
      return Promise.resolve();
    },
    deleteSecretByRef: (ref: string) => {
      mockKeychain.delete(ref);
      return Promise.resolve();
    },
  }),
}));

import { handlePluginCommand } from './plugin-commands.js';
import type { HostCommandContext } from './host-command-context.js';

function makeContext(piwinRoot: string): HostCommandContext {
  return {
    piwinRoot,
    push: (_message: HostPush) => undefined,
    requireSession: () => {
      throw new Error('not needed for plugin tests');
    },
    getMcpManager: () => {
      throw new Error('not needed for plugin tests');
    },
    getJobController: () => {
      throw new Error('not needed for plugin tests');
    },
    todoStore: {} as never,
    petStateStore: {} as never,
    runCronJob: async () => ({ ok: true }),
    pendingPermissions: new Map(),
    pendingExtensionUi: new Map(),
    rememberProjectPermission: async () => undefined,
    rememberSessionPermission: () => undefined,
    sessionPermissionOverrides: new Map(),
    setSessionPermissionOverride: () => undefined,
    clearSessionPermissionOverride: () => undefined,
  };
}

async function makePluginDir(parent: string): Promise<string> {
  const pluginDir = join(parent, 'test-plugin');
  await mkdir(join(pluginDir, 'skills', 'foo'), { recursive: true });
  await writeFile(
    join(pluginDir, 'plugin.json'),
    JSON.stringify({
      id: 'test-plugin',
      version: '1.0.0',
      name: 'Test Plugin',
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

describe('handlePluginCommand', () => {
  it('install → list → uninstall round-trip', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-plugin-cmd-'));
    const sourceParent = await mkdtemp(join(tmpdir(), 'piwin-src-'));
    const pluginDir = await makePluginDir(sourceParent);
    const context = makeContext(root);

    // Override writeSecret via a mock keychain — we inject through install options
    // but handlePluginCommand uses defaultWriteKeychain. On non-macOS or for tests,
    // we mock by intercepting. Since we can't easily inject, test the parts that work.
    // Instead, test without secrets (manifest has required secret, so install should fail
    // unless we provide secrets).
    try {
      // Install with secrets provided.
      const installCmd: HostCommand = {
        type: 'plugins/install',
        source: { kind: 'local', path: pluginDir },
        secrets: { API_KEY: 'sk-test' },
      };
      const installResult = await handlePluginCommand(installCmd, 'req-1', context);
      expect(installResult?.type).toBe('response');
      expect(installResult).toHaveProperty('success', true);

      // List — should show the installed plugin.
      const listResult = await handlePluginCommand({ type: 'plugins/list' }, 'req-2', context);
      expect(listResult?.type).toBe('response');
      const listData = (listResult as { data?: { plugins: unknown[] } }).data;
      expect(listData?.plugins).toHaveLength(1);

      // MCP config should contain the namespaced server.
      const mcpConfig = await loadMcpConfig(root);
      expect(mcpConfig.mcpServers['plugin__test-plugin__my-server']).toBeDefined();

      // Skill should be installed.
      const skillFile = await readFile(join(root, 'skills', 'foo', 'SKILL.md'), 'utf8');
      expect(skillFile).toContain('name: foo');

      // Uninstall.
      const uninstallResult = await handlePluginCommand(
        { type: 'plugins/uninstall', pluginId: 'test-plugin' },
        'req-3',
        context,
      );
      expect(uninstallResult?.type).toBe('response');
      expect(uninstallResult).toHaveProperty('success', true);

      // List should be empty.
      const listAfter = await handlePluginCommand({ type: 'plugins/list' }, 'req-4', context);
      const afterData = (listAfter as { data?: { plugins: unknown[] } }).data;
      expect(afterData?.plugins).toHaveLength(0);

      // MCP config should no longer have the server.
      const mcpAfter = await loadMcpConfig(root);
      expect(mcpAfter.mcpServers['plugin__test-plugin__my-server']).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
      await rm(sourceParent, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('returns null for non-plugin commands', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-plugin-cmd-'));
    try {
      const result = await handlePluginCommand(
        { type: 'skills/list' } as HostCommand,
        'req-x',
        makeContext(root),
      );
      expect(result).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('installs bundled Cloudflare from the marketplace catalog', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-plugin-cmd-'));
    try {
      const result = await handlePluginCommand(
        { type: 'plugins/install', source: { kind: 'bundled', bundledId: 'cloudflare' } },
        'req-cf',
        makeContext(root),
      );
      expect(result).toHaveProperty('success', true);
      const listed = await handlePluginCommand(
        { type: 'plugins/list' },
        'req-list',
        makeContext(root),
      );
      const plugins = (listed as { data?: { plugins: Array<{ id: string }> } }).data?.plugins ?? [];
      expect(plugins.map((plugin) => plugin.id)).toContain('cloudflare');
      const mcpConfig = await loadMcpConfig(root);
      expect(mcpConfig.mcpServers['plugin__cloudflare__api']?.command).toBe('npx');
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('uninstall fails for non-existent plugin', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-plugin-cmd-'));
    try {
      const result = await handlePluginCommand(
        { type: 'plugins/uninstall', pluginId: 'nope' },
        'req-x',
        makeContext(root),
      );
      expect(result?.type).toBe('response');
      expect(result).toHaveProperty('success', false);
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
