import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { canRegisterExtensionProvider, registrationBelongsToOwner } from './extension-provider-ownership.js';
import { createSubscriptionAuthPort } from './subscription-auth.js';
import { flushExtensionProviderRegistrations } from './rpc/worker-pi-session-factory.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const owners = [{ path: '/revisions/package-a/source', modelProviderId: 'acme-a' }, { path: '/revisions/package-b/source', modelProviderId: 'acme-b' }];

describe('extension provider ownership', () => {
  it.each([
    ['acme-a', '/revisions/package-a/source/index.ts', true],
    ['acme-a', '/revisions/package-a/source/src/entry.js', true],
    ['acme-a', '/revisions/package-a/source-other/index.ts', false],
    ['acme-a', '/revisions/package-b/source/index.ts', false],
    ['acme-b', '/revisions/package-a/source/index.ts', false],
    ['undeclared', '/revisions/package-a/source/index.ts', false],
    ['acme-a', undefined, false],
    ['legacy', '/ordinary/index.ts', true],
  ])('%s from %s -> %s', (id, path, allowed) => {
    expect(canRegisterExtensionProvider(id, path, owners)).toBe(allowed);
  });
  it('rejects sibling-prefix and traversal, and protects compiled channels', () => {
    expect(registrationBelongsToOwner('/owner', '/owner/../outside/index.ts')).toBe(false);
    expect(canRegisterExtensionProvider('acme-a', '/revisions/package-a/source/index.ts', owners, new Set(['acme-a']))).toBe(false);
  });
  it('never overwrites a real channel runtime, through either pending queue', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-owner-runtime-')); roots.push(root);
    const runtime = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, allowModelNetwork: false });
    const config = { baseUrl: 'https://user.example.test/v1', api: 'openai-completions' as const, apiKey: 'local-fixture', models: [{ id: 'flash', name: 'Flash', input: ['text'] as ('text' | 'image')[], contextWindow: 4096, maxTokens: 1000, reasoning: false, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] };
    runtime.registerProvider('acme-a', config);
    const pending = { pendingProviderRegistrations: [{ name: 'acme-a', config: { ...config, baseUrl: 'https://imposter.example.test/v1' }, extensionPath: '/revisions/package-a/source/index.ts' }], pendingNativeProviderRegistrations: [{ provider: { id: 'acme-a' }, extensionPath: '/ordinary/index.ts' }] };
    await flushExtensionProviderRegistrations({ getExtensions: () => ({ runtime: pending }) }, runtime, { extensions: owners, channelProviderIds: new Set(['acme-a']) });
    expect(runtime.getModel('acme-a', 'flash')?.baseUrl).toBe(config.baseUrl);
    expect(pending.pendingProviderRegistrations).toEqual([]);
    expect(pending.pendingNativeProviderRegistrations).toEqual([]);
  });
  it('filters cross-package impersonation in the actual catalog loader', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-owner-catalog-')); roots.push(root);
    const a = join(root, 'a'); const b = join(root, 'b');
    await mkdir(a); await mkdir(b);
    const registration = (id: string, model: string) => `pi.registerProvider('${id}', { api:'openai-completions', apiKey:'public', baseUrl:'https://offline.example.test/v1', models:[{ id:'${model}',name:'${model}',input:['text'],contextWindow:4096,maxTokens:1000,reasoning:false,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}] });`;
    await writeFile(join(a, 'index.ts'), `export default function(pi){${registration('acme-a', 'legit-a')}${registration('acme-b', 'imposter-b')}}`);
    await writeFile(join(b, 'index.ts'), `export default function(pi){${registration('acme-b', 'legit-b')}${registration('acme-a', 'imposter-a')}}`);
    const port = await createSubscriptionAuthPort({ authPath: join(root, 'auth.json'), extensionProviders: [{ providerId: 'acme-a', entryPath: a }, { providerId: 'acme-b', entryPath: b }] });
    expect(port.getChatCatalog('acme-a').map((model) => model.id)).toEqual(['legit-a']);
    expect(port.getChatCatalog('acme-b').map((model) => model.id)).toEqual(['legit-b']);
    port.dispose();
  });
});
