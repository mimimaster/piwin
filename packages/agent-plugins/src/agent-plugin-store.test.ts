import { describe, expect, it } from 'vitest';
import { AgentPluginStore, type AgentPluginStorePort } from './agent-plugin-store.js';
import { GROK_PLUGIN_MANIFEST, parseAgentPluginManifest } from './manifest.js';

function fixture() {
  let document: unknown;
  let writes = 0;
  const port: AgentPluginStorePort = {
    read: async () => document,
    mutate: async (operation) => {
      const changed = operation(document);
      document = changed.document;
      writes++;
      return changed.result;
    },
  };
  const store = new AgentPluginStore(port);
  const install = () => store.install({ manifest: GROK_PLUGIN_MANIFEST, source: { kind: 'bundled', agentId: 'grok' }, platform: 'darwin' });
  return { store, install, port, writes: () => writes };
}

describe('declarative agent inventory', () => {
  it('starts empty and installing is idempotent without starting any runtime', async () => {
    const { store, install } = fixture();
    expect(await store.list()).toEqual([]);
    const first = await install();
    expect(first.enabled).toBe(true);
    expect(await install()).toEqual(first);
    expect(await store.list()).toHaveLength(1);
  });

  it('persists enable/disable and user-owned dependency selection across store instances', async () => {
    const { store, install, port } = fixture();
    await install();
    await store.selectRuntime('grok', '/opt/grok');
    await store.setEnabled('grok', false);
    const reopened = new AgentPluginStore(port);
    expect(await reopened.get('grok')).toMatchObject({ enabled: false, runtime: { ownership: 'user', binaryPath: '/opt/grok' } });
    await reopened.setEnabled('grok', true);
    expect((await store.get('grok'))?.enabled).toBe(true);
  });

  it('uninstalls only inventory and keeps the domain without filesystem deletion capabilities', async () => {
    const { store, install } = fixture();
    await install();
    await store.uninstall('grok');
    expect(await store.get('grok')).toBeUndefined();
    await store.uninstall('grok');
  });

  it('refuses unverified platforms and runtime paths before mutation', async () => {
    const { store, writes } = fixture();
    expect(() => store.install({ manifest: GROK_PLUGIN_MANIFEST, source: { kind: 'bundled', agentId: 'grok' }, platform: 'win32' })).toThrow('platform-unverified');
    expect(() => store.selectRuntime('grok', 'grok; curl bad')).toThrow('path-invalid');
    expect(writes()).toBe(0);
  });

  it('rejects malformed mutation payloads before persisting them', async () => {
    const { store, install, writes } = fixture();
    await install();
    const previousWrites = writes();
    expect(() => store.setEnabled('grok', 'yes' as unknown as boolean)).toThrow('enabled-invalid');
    expect(() => store.uninstall('unknown')).toThrow('unknown-agent');
    expect(writes()).toBe(previousWrites);
    expect((await store.get('grok'))?.enabled).toBe(true);
  });

  it('does not silently replace an immutable installed revision', async () => {
    const { store, install } = fixture();
    const installed = await install();
    await expect(store.install({ manifest: { ...GROK_PLUGIN_MANIFEST, version: '1.0.1' }, source: { kind: 'bundled', agentId: 'grok' }, platform: 'darwin' })).rejects.toThrow('requires-migration');
    expect(await store.get('grok')).toEqual(installed);
  });

  it('fails closed for corrupted inventory rather than overwriting it', async () => {
    const port: AgentPluginStorePort = {
      read: async () => ({ schemaVersion: 99 }),
      mutate: async (operation) => operation({ schemaVersion: 99 }).result,
    };
    await expect(new AgentPluginStore(port).list()).rejects.toThrow('inventory-invalid');
    await expect(new AgentPluginStore(port).uninstall('grok')).rejects.toThrow('inventory-invalid');
  });

  it.each(['shell', 'script', 'module', 'installCommand'])('rejects executable manifest field %s', (key) => {
    expect(() => parseAgentPluginManifest({ ...GROK_PLUGIN_MANIFEST, [key]: 'evil' })).toThrow('manifest-invalid');
  });

  it('rejects arbitrary adapters and recipes', () => {
    expect(() => parseAgentPluginManifest({ ...GROK_PLUGIN_MANIFEST, recipe: 'custom-shell' })).toThrow();
    expect(() => parseAgentPluginManifest({ ...GROK_PLUGIN_MANIFEST, id: '../grok' })).toThrow();
    expect(() => parseAgentPluginManifest({ ...GROK_PLUGIN_MANIFEST, minHostVersion: '9.9.9' })).toThrow();
  });
});
