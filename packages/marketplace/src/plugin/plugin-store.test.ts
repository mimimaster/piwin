import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { InstalledPlugin } from '@piwin/contracts';
import {
  clearPluginStore,
  findInstalledPlugin,
  getInstalledPluginsPath,
  loadInstalledPlugins,
  removeInstalledPlugin,
  saveInstalledPlugins,
  upsertInstalledPlugin,
} from './plugin-store.js';

function makePlugin(id: string): InstalledPlugin {
  return {
    id,
    version: '1.0.0',
    name: `Plugin ${id}`,
    installedAt: new Date().toISOString(),
    source: { kind: 'local', path: '/tmp' },
    skills: [],
    mcpServerIds: [],
    secrets: [],
    manifestPath: '/tmp/plugin.json',
  };
}

async function withTempRoot(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'piwin-plugin-store-'));
  try {
    await fn(root);
  } finally {
    await clearPluginStore(root);
  }
}

describe('plugin-store', () => {
  it('returns empty array when no installed.json exists', async () => {
    await withTempRoot(async (root) => {
      const plugins = await loadInstalledPlugins(root);
      expect(plugins).toEqual([]);
    });
  });

  it('upserts and lists plugins', async () => {
    await withTempRoot(async (root) => {
      await upsertInstalledPlugin(root, makePlugin('alpha'));
      await upsertInstalledPlugin(root, makePlugin('beta'));
      const plugins = await loadInstalledPlugins(root);
      expect(plugins).toHaveLength(2);
      expect(plugins.map((p) => p.id).sort()).toEqual(['alpha', 'beta']);
    });
  });

  it('replaces existing plugin on upsert by id', async () => {
    await withTempRoot(async (root) => {
      await upsertInstalledPlugin(root, makePlugin('alpha'));
      const updated = makePlugin('alpha');
      updated.version = '2.0.0';
      await upsertInstalledPlugin(root, updated);
      const plugins = await loadInstalledPlugins(root);
      expect(plugins).toHaveLength(1);
      expect(plugins[0]?.version).toBe('2.0.0');
    });
  });

  it('removes a plugin by id and returns it', async () => {
    await withTempRoot(async (root) => {
      await upsertInstalledPlugin(root, makePlugin('alpha'));
      const removed = await removeInstalledPlugin(root, 'alpha');
      expect(removed?.id).toBe('alpha');
      const plugins = await loadInstalledPlugins(root);
      expect(plugins).toEqual([]);
    });
  });

  it('returns null when removing non-existent plugin', async () => {
    await withTempRoot(async (root) => {
      const removed = await removeInstalledPlugin(root, 'nope');
      expect(removed).toBeNull();
    });
  });

  it('finds a plugin by id', async () => {
    await withTempRoot(async (root) => {
      await upsertInstalledPlugin(root, makePlugin('alpha'));
      const found = await findInstalledPlugin(root, 'alpha');
      expect(found?.id).toBe('alpha');
      const missing = await findInstalledPlugin(root, 'nope');
      expect(missing).toBeUndefined();
    });
  });

  it('writes to the expected path', async () => {
    await withTempRoot(async (root) => {
      await saveInstalledPlugins(root, [makePlugin('alpha')]);
      const path = getInstalledPluginsPath(root);
      expect(path).toBe(join(root, 'plugins', 'installed.json'));
    });
  });
});
