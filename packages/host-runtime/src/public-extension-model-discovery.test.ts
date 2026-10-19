import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostPush } from '@piwin/contracts';
import { createExtensionRevisionStore, installExtension } from '@piwin/extensions';
import { SubscriptionAuthService } from './subscription-auth-service.js';
import { loadPiwinConfig } from './config-store.js';
import { handleCatalogCommand } from './commands/catalog-commands.js';
import { pushExtensionCatalog } from './commands/catalog-resources.js';
import type { HostCommandContext } from './commands/host-command-context.js';

const roots: string[] = [];
const services: SubscriptionAuthService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) service.dispose();
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'piwin-live-public-')); roots.push(root);
  const source = join(root, 'plugin'); await mkdir(source);
  await writeFile(join(source, 'index.ts'), `export default function(pi) {
    pi.registerProvider('live-public', {
      apiKey: 'public', api: 'openai-completions', baseUrl: 'https://catalog.example.test/v1', models: [],
      async refreshModels(context) {
        if (!context.allowNetwork) return context.stored?.models ?? [];
        const response = await fetch('https://catalog.example.test/models', { signal: context.signal });
        const models = response.ok ? await response.json() : [];
        await context.publish({ persist: { models: models.map((model) => ({ ...model, provider: 'live-public', api: 'openai-completions', baseUrl: 'https://catalog.example.test/v1' })) } });
        return models;
      },
    });
  }`);
  await writeFile(join(source, 'piwin.json'), JSON.stringify({ modelProvider: { id: 'live-public', auth: 'none' } }));
  const installed = await installExtension({ piwinRoot: root, source: { kind: 'local', path: source } });
  const store = createExtensionRevisionStore(root);
  const service = new SubscriptionAuthService({ piwinRoot: root }); services.push(service);
  const pushes: HostPush[] = [];
  const context = { piwinRoot: root, subscriptionAuth: service, push: (message: HostPush) => { pushes.push(message); } } as unknown as HostCommandContext;
  return { root, installed, store, service, context, pushes };
}
const model = (id: string) => ({ id, name: id, reasoning: true, input: ['text'], contextWindow: 123456, maxTokens: 6789, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });

describe('public extension dynamic model discovery', () => {
  it('automatically fetches once on enable/catalog publication without OAuth or UI discovery', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => Response.json([model('remote-first')])); vi.stubGlobal('fetch', fetchImplementation);
    const { root, installed, store, service, context, pushes } = await setup();
    await service.status(); expect(fetchImplementation).not.toHaveBeenCalled();
    const registry = await store.setEnabled(installed.extensionId, true);
    await pushExtensionCatalog(context, root, registry.revision);
    expect(pushes).toContainEqual(expect.objectContaining({
      type: 'extension/catalog-updated', registryRevision: (await store.readRegistry()).revision,
    }));
    const config = await loadPiwinConfig(root);
    expect(config.providers.find((provider) => provider.id === 'live-public')?.models).toEqual([expect.objectContaining({ id: 'remote-first', contextWindow: 123456 })]);
    expect((await service.status()).accounts.some((account) => account.providerId === 'live-public')).toBe(false);
    await service.chatResolveInput();
    // Catalog publication also installs shipped providers, each with its own
    // first pull. Count this extension's request independently of built-ins.
    expect(fetchImplementation.mock.calls.filter(([url]) => String(url) === 'https://catalog.example.test/models')).toHaveLength(1);
  });

  it('shares the first network pull across simultaneous initial readers', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => Response.json([model('remote-first')])); vi.stubGlobal('fetch', fetchImplementation);
    const { installed, store, service } = await setup();
    await store.setEnabled(installed.extensionId, true);
    await Promise.all([service.status(), service.status(), service.chatResolveInput()]);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it('publishes no initial models after a failed discovery and manual retry replaces results', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => new Response('offline', { status: 503 })); vi.stubGlobal('fetch', fetchImplementation);
    const { root, installed, store, service, context } = await setup();
    await store.setEnabled(installed.extensionId, true);
    await service.status();
    let config = await loadPiwinConfig(root);
    const provider = config.providers.find((entry) => entry.id === 'live-public');
    expect(provider?.models).toEqual([]); if (!provider) throw new Error('missing public provider');
    fetchImplementation.mockImplementation(async () => Response.json([model('remote-new')]));
    const response = await handleCatalogCommand({ type: 'models/discover', provider }, 'retry', context);
    expect(response).toMatchObject({ success: true, data: { providerId: provider.id, models: [{ id: 'remote-new' }] } });
    config = await loadPiwinConfig(root);
    expect(config.providers.find((entry) => entry.id === provider.id)?.models.map((entry) => entry.id)).toEqual(['remote-new']);
    fetchImplementation.mockImplementation(async () => new Response('offline', { status: 503 }));
    await service.discoverExtensionModels(provider.id);
    expect((await loadPiwinConfig(root)).providers.find((entry) => entry.id === provider.id)?.models).toEqual([]);
    const stored = JSON.parse(await readFile(join(root, 'pi-agent/models-store.json'), 'utf8')) as unknown;
    expect(JSON.stringify(stored)).not.toContain('remote-new');
  });

  it('rejects discovery after disable and never calls an arbitrary shell-supplied URL', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => Response.json([model('remote-first')])); vi.stubGlobal('fetch', fetchImplementation);
    const { root, installed, store, service, context } = await setup();
    await store.setEnabled(installed.extensionId, true); await service.status();
    const provider = (await loadPiwinConfig(root)).providers.find((entry) => entry.id === 'live-public'); if (!provider) throw new Error('missing provider');
    await handleCatalogCommand({ type: 'models/discover', provider: { ...provider, baseUrl: 'https://arbitrary.example.test/' } }, 'safe', context);
    expect(fetchImplementation.mock.calls.every((call) => String(call[0]) === 'https://catalog.example.test/models')).toBe(true);
    await store.setEnabled(installed.extensionId, false);
    await expect(service.discoverExtensionModels(provider.id)).rejects.toThrow('unavailable');
  });
});
