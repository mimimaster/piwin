import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseExtensionModelProviderClaim, projectConfiguredChatModels } from '@piwin/contracts';
import { createExtensionRevisionStore, installExtension } from '@piwin/extensions';
import { createSubscriptionAuthPort, createBackendSdkSession, createWorkerPiSessionFactory } from '@piwin/agent-host';
import { readSubscriptionExtensionProviders } from './subscription-extension-providers.js';
import { projectPublicModelProviders } from './extension-model-provider-projection.js';
import { buildExtensionProviderSnapshot } from './extension-provider-snapshot.js';
import { resolveChatModel } from './resolve-chat-model.js';
import { loadPiwinConfig } from './config-store.js';
import { compileBlueprintForWorker } from './blueprint-compiler.js';
import { SubscriptionAuthService } from './subscription-auth-service.js';

const roots: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'piwin-public-provider-'));
  roots.push(root);
  const source = join(root, 'plugin');
  await mkdir(join(source, 'src'), { recursive: true });
  await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'test-public', pi: { extensions: ['./src/provider.js'] } }));
  await writeFile(join(source, 'index.ts'), "export { default } from './src/provider.js';\n");
  await writeFile(join(source, 'piwin.json'), JSON.stringify({ modelProvider: { id: 'acme-public', auth: 'none' } }));
  await writeFile(join(source, 'src/provider.js'), `export default function(pi) {
    pi.registerProvider('acme-public', { apiKey:'public', baseUrl:'https://public.example.test/v1', api:'openai-completions',
      models:[{id:'flash',name:'Flash',input:['text'],contextWindow:32000,maxTokens:4000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}] });
  }`);
  const installed = await installExtension({ piwinRoot: root, source: { kind: 'local', path: source } });
  const store = createExtensionRevisionStore(root);
  expect(await readSubscriptionExtensionProviders(root)).toEqual([]);
  await store.setEnabled(installed.extensionId, true);
  const claims = await readSubscriptionExtensionProviders(root);
  const port = await createSubscriptionAuthPort({ authPath: join(root, 'agent/auth.json'), extensionProviders: claims });
  const config = projectPublicModelProviders(await loadPiwinConfig(root), claims, (id) => port.getChatCatalog(id));
  const snapshot = buildExtensionProviderSnapshot([], claims, config, (id) => port.getChatCatalog(id).map((model) => model.id));
  return { root, source, installed, store, claims, port, config, snapshot };
}

async function assertActualSessions(root: string, compiled: Awaited<ReturnType<typeof compileBlueprintForWorker>>, agentDir = join(root, 'runtime-agent')) {
  await mkdir(agentDir, { recursive: true });
  const sdk = await createBackendSdkSession({ blueprint: compiled.backendBlueprint, providers: compiled.providers, hostToolExecution: { execute: async () => ({ ok: true, output: '' }) } }, { agentDir });
  await sdk.abort();
  const workerProviders = compiled.providers.map(({ auth, ...runtime }) => {
    if (auth.kind === 'inline') throw new Error('fixture must not send inline credentials');
    return { ...runtime, auth };
  });
  const worker = await createWorkerPiSessionFactory({ agentDir })({ productSessionId: 'public-rpc', runtimeGenerationId: 'public-rpc-1', blueprint: compiled.blueprint, providers: workerProviders });
  await worker.abort?.();
}

describe('public extension model provider vertical slice', () => {
  it.skipIf(!process.env.PIWIN_TEST_PUBLIC_PROVIDER_PACKAGE)('installs the independent package and resolves its real SDK/RPC models offline', async () => {
    const source = process.env.PIWIN_TEST_PUBLIC_PROVIDER_PACKAGE;
    if (!source) throw new Error('explicit fixture package path required');
    const root = await mkdtemp(join(tmpdir(), 'piwin-independent-provider-')); roots.push(root);
    const fixture = createRequire(import.meta.url)(join(source, 'test/catalog-fixture.mjs')) as { catalogFetch: typeof fetch };
    vi.stubGlobal('fetch', fixture.catalogFetch);
    const installed = await installExtension({ piwinRoot: root, source: { kind: 'local', path: source } });
    await createExtensionRevisionStore(root).setEnabled(installed.extensionId, true);
    const claims = await readSubscriptionExtensionProviders(root);
    const claim = claims[0]; if (!claim) throw new Error('package must declare a public provider');
    expect(claim.kind).toBe('model');
    const port = await createSubscriptionAuthPort({ authPath: join(root, 'agent/auth.json'), extensionProviders: claims });
    expect(await port.listCredentials()).toEqual([]);
    const catalog = port.getChatCatalog(claim.providerId);
    const model = catalog[0]; if (!model) throw new Error('package did not publish a model');
    const config = projectPublicModelProviders(await loadPiwinConfig(root), claims, (id) => port.getChatCatalog(id));
    const snapshot = buildExtensionProviderSnapshot([], claims, config, (id) => port.getChatCatalog(id).map((entry) => entry.id));
    const compiled = await compileBlueprintForWorker({ scope: { kind: 'general' }, model: { providerId: claim.providerId, modelId: model.id, source: 'extension' } }, { piwinRoot: root, config, subscriptionAccounts: snapshot });
    await assertActualSessions(root, compiled, join(root, 'agent'));
    port.dispose();
  });
  it.each([
    { modelProvider: { id: '../unsafe', auth: 'none' } },
    { modelProvider: { id: 'openai-codex', auth: 'none' } },
    { modelProvider: { id: 'acme', auth: 'oauth' } },
    { modelProvider: { id: 'acme', auth: 'none' }, authProvider: 'other' },
  ])('rejects invalid or ambiguous manifest %j', (manifest) => {
    expect(parseExtensionModelProviderClaim(manifest)).toBe('invalid');
  });

  it('installs an immutable directory, publishes no account, and compiles pure chat with its revision', async () => {
    const { root, installed, claims, port, config, snapshot, store } = await setup();
    expect(claims[0]?.entryPath).toBe(installed.packageRoot);
    expect(await port.listCredentials()).toEqual([]);
    expect(snapshot.accounts).toEqual([]);
    expect(projectConfiguredChatModels(config).models).toContainEqual(expect.objectContaining({ source: 'extension', modelId: 'flash' }));
    const compiled = await compileBlueprintForWorker({ scope: { kind: 'general' }, model: { providerId: 'acme-public', modelId: 'flash', source: 'extension' } }, { piwinRoot: root, config, subscriptionAccounts: snapshot });
    expect(compiled.providers).toContainEqual(expect.objectContaining({ auth: { kind: 'extension', providerId: 'acme-public' } }));
    expect(compiled.blueprint.resourceManifest.extensions).toContainEqual(expect.objectContaining({ path: installed.packageRoot, contentRevision: installed.contentRevision, modelProviderId: 'acme-public' }));
    await store.setEnabled(installed.extensionId, false);
    const disabled = await readSubscriptionExtensionProviders(root);
    const stale = buildExtensionProviderSnapshot([], disabled, config, () => []);
    expect(resolveChatModel(config, { providerId: 'acme-public', modelId: 'flash', source: 'extension' }, stale)).toBeUndefined();
    await expect(compileBlueprintForWorker({ scope: { kind: 'general' }, model: { providerId: 'acme-public', modelId: 'flash', source: 'extension' } }, { piwinRoot: root, config, subscriptionAccounts: stale })).rejects.toMatchObject({ code: 'provider-unavailable' });
    const withdrawn = projectPublicModelProviders(config, disabled, () => []);
    expect(withdrawn.providers.some((provider) => provider.source === 'extension')).toBe(false);
    await expect(compileBlueprintForWorker({ scope: { kind: 'general' } }, { piwinRoot: root, config: { ...withdrawn, defaultProviderId: 'acme-public', defaultModelId: 'flash' }, subscriptionAccounts: stale })).rejects.toMatchObject({ code: 'provider-unavailable' });
    port.dispose();
  });

  it('does not create an OAuth card or offer login for a public claim', async () => {
    const { root, config, port } = await setup();
    const service = new SubscriptionAuthService({ piwinRoot: root, piAgentDir: join(root, 'agent'), port }, { loadConfig: async () => config });
    expect((await service.status()).accounts.some((account) => account.providerId === 'acme-public')).toBe(false);
    expect((await service.chatResolveInput()).publicModelProviders?.map((claim) => claim.providerId)).toEqual(['acme-public']);
    expect(await service.login({ providerId: 'acme-public', ownerDeviceId: 'fixture' })).toMatchObject({ code: 'unsupported-subscription-provider' });
    service.dispose();
  });

  it('rejects every duplicate claimant and reloads the actual selected revision', async () => {
    const { root, source, installed, store, config, port } = await setup();
    await writeFile(join(source, 'src/provider.js'), (await readFile(join(source, 'src/provider.js'), 'utf8')).replace("id:'flash'", "id:'flash-next'"));
    const updated = await store.stage({ sourcePath: source });
    await store.selectRevision(updated.extensionId, updated.contentRevision);
    expect(updated.contentRevision).not.toBe(installed.contentRevision);
    const nextClaims = await readSubscriptionExtensionProviders(root);
    expect(nextClaims[0]?.contentRevision).toBe(updated.contentRevision);
    const updatedPort = await createSubscriptionAuthPort({ authPath: join(root, 'next/auth.json'), extensionProviders: nextClaims });
    const nextConfig = projectPublicModelProviders(config, nextClaims, (id) => updatedPort.getChatCatalog(id));
    expect(nextConfig.providers.find((provider) => provider.id === 'acme-public')?.models.map((model) => model.id)).toEqual(['flash-next']);
    const second = join(root, 'second'); await mkdir(second);
    await writeFile(join(second, 'index.ts'), 'export default function(){}');
    await writeFile(join(second, 'piwin.json'), JSON.stringify({ modelProvider: { id: 'acme-public', auth: 'none' } }));
    const duplicate = await store.stage({ sourcePath: second }); await store.setEnabled(duplicate.extensionId, true);
    expect(await readSubscriptionExtensionProviders(root)).toEqual([]);
    updatedPort.dispose(); port.dispose();
  });

  it('resolves the installed package through actual SDK and RPC Pi sessions offline', async () => {
    const { root, config, snapshot, port } = await setup();
    const compiled = await compileBlueprintForWorker({ scope: { kind: 'general' }, model: { providerId: 'acme-public', modelId: 'flash', source: 'extension' } }, { piwinRoot: root, config, subscriptionAccounts: snapshot });
    await assertActualSessions(root, compiled);
    port.dispose();
  });

  it('isolates user-channel collisions, preserves overrides, and withdraws removed models', async () => {
    const { root, claims, port, config, snapshot } = await setup();
    const provider = config.providers.find((entry) => entry.id === 'acme-public');
    if (!provider || !provider.models[0]) throw new Error('fixture provider missing');
    provider.models[0].enabled = false;
    provider.models[0].contextWindow = 12345;
    const refreshed = projectPublicModelProviders(config, claims, (id) => port.getChatCatalog(id));
    expect(refreshed.providers.find((entry) => entry.id === provider.id)?.models[0]).toMatchObject({ enabled: false, contextWindow: 12345 });
    expect(projectPublicModelProviders(config, claims, () => []).providers.find((entry) => entry.id === provider.id)?.models).toEqual([]);
    const channel = { ...provider, source: 'channel' as const, baseUrl: 'https://user.example.test/v1' };
    const colliding = { ...config, providers: [channel] };
    expect(projectPublicModelProviders(colliding, claims, () => [])).toBe(colliding);
    const filtered = buildExtensionProviderSnapshot([], claims, colliding, () => ['flash']);
    expect(filtered.publicModelProviders).toEqual([]);
    await expect(compileBlueprintForWorker({ scope: { kind: 'general' }, model: { providerId: channel.id, modelId: 'flash', source: 'extension' } }, { piwinRoot: root, config: colliding, subscriptionAccounts: filtered })).rejects.toMatchObject({ code: 'provider-unavailable' });
    expect(snapshot.accounts).toEqual([]);
    port.dispose();
  });
});
