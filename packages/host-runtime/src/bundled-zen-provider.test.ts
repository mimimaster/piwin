import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExtensionRevisionStore } from '@piwin/extensions';
import { SubscriptionAuthService } from './subscription-auth-service.js';
import { ensureBundledExtensionsInstalled } from './ensure-bundled-extensions.js';
import { loadPiwinConfig } from './config-store.js';
import { compileBlueprintForWorker } from './blueprint-compiler.js';

const roots: string[] = [];
const services: SubscriptionAuthService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) service.dispose();
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'piwin-bundled-zen-')); roots.push(root);
  const prepare = vi.fn(() => ensureBundledExtensionsInstalled(root));
  const service = new SubscriptionAuthService({ piwinRoot: root }, { prepareExtensions: prepare });
  services.push(service);
  return { root, service, prepare };
}

describe('shipped Zen provider', () => {
  it('cancels discovery when disposed during bundled installation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-zen-shutdown-')); roots.push(root);
    let finishInstall: (() => void) | undefined;
    const installing = new Promise<void>((resolve) => { finishInstall = resolve; });
    const service = new SubscriptionAuthService({ piwinRoot: root }, { prepareExtensions: () => installing });
    services.push(service);
    const fetchImplementation = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetchImplementation);
    const discovery = service.ensureLoggedInProviders();
    const rejected = expect(discovery).rejects.toMatchObject({ name: 'AbortError' });
    service.dispose();
    finishInstall?.();
    await rejected;
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('auto-installs before first provider discovery, pulls once, and binds the built-in revision', async () => {
    const fixture = createRequire(import.meta.url)('../../agent-host/bundled-extensions/piwin-opencode-zen/test/catalog-fixture.mjs') as { catalogFetch: typeof fetch };
    const fetchImplementation = vi.fn(fixture.catalogFetch); vi.stubGlobal('fetch', fetchImplementation);
    const { root, service, prepare } = await setup();
    await service.ensureLoggedInProviders();
    const config = await loadPiwinConfig(root);
    const zen = config.providers.find((provider) => provider.id === 'opencode-zen');
    expect(prepare).toHaveBeenCalled();
    expect(zen).toMatchObject({ name: 'OpenCode Zen', source: 'extension',
      extension: { bundled: true, notice: '模型使用受官方IP管制，受环境因素影响不保证可用，若不可用，可调整使用IP尝试' },
      models: [{ id: 'future-free', contextWindow: 123456, maxOutputTokens: 6789 }],
    });
    const snapshot = await service.chatResolveInput();
    expect(snapshot.accounts).not.toContainEqual(expect.objectContaining({ providerId: 'opencode-zen' }));
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    const record = await createExtensionRevisionStore(root).getRecord('piwin-mimimaster-opencode-zen');
    const compiled = await compileBlueprintForWorker({ scope: { kind: 'general' },
      model: { providerId: 'opencode-zen', modelId: 'future-free', source: 'extension' },
    }, { piwinRoot: root, config, subscriptionAccounts: snapshot });
    expect(compiled.blueprint.resourceManifest.extensions).toContainEqual(expect.objectContaining({
      modelProviderId: 'opencode-zen', source: 'bundled', contentRevision: record?.selectedRevision,
    }));
    fetchImplementation.mockImplementation(async () => new Response('IP restricted', { status: 403 }));
    await service.discoverExtensionModels('opencode-zen');
    expect((await loadPiwinConfig(root)).providers.find((provider) => provider.id === 'opencode-zen')?.models).toEqual([]);
    expect(await readFile(join(root, 'pi-agent/models-store.json'), 'utf8')).not.toContain('future-free');
  });

  it('aborts an in-flight initial catalog pull on shutdown', async () => {
    let announceFetch: (() => void) | undefined;
    const fetching = new Promise<void>((resolve) => { announceFetch = resolve; });
    const fetchImplementation = vi.fn<typeof fetch>(async (_input, init) => {
      const signal = init?.signal;
      if (!signal) throw new Error('catalog fetch must be cancellable');
      announceFetch?.();
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    });
    vi.stubGlobal('fetch', fetchImplementation);
    const { service } = await setup();
    const startup = service.ensureLoggedInProviders();
    const rejected = expect(startup).rejects.toMatchObject({ name: 'AbortError' });
    await fetching;
    service.dispose();
    await rejected;
    expect(fetchImplementation.mock.calls.every(([, init]) => init?.signal?.aborted)).toBe(true);
  });

  it('shows zero models when the initial live check fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('offline', { status: 503 })));
    const { root, service } = await setup();
    await service.ensureLoggedInProviders();
    expect((await loadPiwinConfig(root)).providers.find((provider) => provider.id === 'opencode-zen')).toMatchObject({
      name: 'OpenCode Zen', models: [], extension: { bundled: true },
    });
  });
});
