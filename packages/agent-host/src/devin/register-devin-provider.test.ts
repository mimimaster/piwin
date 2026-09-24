import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { mergeDevinModels, registerDevinOauthProvider } from './register-devin-provider.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('mergeDevinModels', () => {
  it('keeps the account catalog first and adds fallback ids it does not list', () => {
    const merged = mergeDevinModels([
      { id: 'swe-1-6-slow', label: 'SWE-1.6 Slow', contextWindow: 100_000 },
      { id: 'swe-1-7', label: 'SWE-1.7 (catalog)' },
    ]);
    expect(merged.map((model) => model.id)).toEqual(['swe-1-6-slow', 'swe-1-7', 'swe-1-6']);
    expect(merged[0]).toMatchObject({ name: 'SWE-1.6 Slow', contextWindow: 100_000, maxTokens: 64_000 });
    expect(merged[1]?.name).toBe('SWE-1.7 (catalog)');
  });
});

describe('registerDevinOauthProvider with the real Pi ModelRuntime', () => {
  it('lets a session select a catalog-only model such as swe-1-6-slow', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-devin-models-'));
    roots.push(root);
    const piModule = (await import('@earendil-works/pi-coding-agent')) as unknown as {
      ModelRuntime: {
        create: (options: { authPath: string; refreshOnCreate?: boolean; allowModelNetwork?: boolean }) => Promise<{
          registerProvider(id: string, config: object): void;
          getModel(providerId: string, modelId: string): unknown;
        }>;
      };
    };
    const runtime = await piModule.ModelRuntime.create({
      authPath: join(root, 'auth.json'),
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    registerDevinOauthProvider(runtime, { models: [{ id: 'swe-1-6-slow', label: 'SWE-1.6 Slow' }] });
    expect(runtime.getModel('devin', 'swe-1-6-slow')).toBeDefined();
    expect(runtime.getModel('devin', 'swe-1-6')).toBeDefined();
  });
});
