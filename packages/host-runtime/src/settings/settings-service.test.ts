import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PiwinConfig, SettingsMutation } from '@piwin/contracts';
import { PIWIN_SETTINGS_SCHEMA_VERSION } from '@piwin/contracts';
import { getPiwinConfigPath } from '../paths.js';
import {
  SettingsRevisionConflictError,
  SettingsService,
  applySettingsMutations,
  classifySettingsImpact,
  createSettingsSnapshot,
  migrateSettingsDocument,
} from './settings-service.js';

let piwinRoot: string;

beforeEach(async () => {
  piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-settings-service-'));
});

afterEach(async () => {
  await rm(piwinRoot, { recursive: true, force: true });
});

function mutation(
  domain: 'automation' | 'permissions' | 'web' | 'providers',
  value: unknown,
): SettingsMutation {
  return { kind: 'replace-domain', domain, value } as SettingsMutation;
}

/** Config whose Host web_search is exclusively backed by a ready delegate model. */
function delegateBackedConfig(
  base: PiwinConfig,
  options: {
    searchSources: NonNullable<PiwinConfig['web']>['searchSources'];
    searchRoutePolicy?: NonNullable<PiwinConfig['web']>['searchRoutePolicy'];
  },
): { previous: PiwinConfig; delegateProvider: NonNullable<PiwinConfig['providers']>[number] } {
  const delegateProvider: NonNullable<PiwinConfig['providers']>[number] = {
    id: 'search-p',
    protocol: 'openai-compatible',
    name: 'Search',
    baseUrl: 'https://example.test/v1',
    enabled: true,
    models: [{ id: 'search-m', enabled: true, capabilities: ['chat', 'native-web-search'] }],
  };
  const previous: PiwinConfig = {
    ...base,
    providers: [delegateProvider],
    web: {
      ...(base.web ?? ({} as NonNullable<PiwinConfig['web']>)),
      searchProvider: 'none',
      searchSources: options.searchSources,
      searchDelegateModel: {
        protocol: 'openai-compatible',
        providerId: 'search-p',
        modelId: 'search-m',
      },
      ...(options.searchRoutePolicy ? { searchRoutePolicy: options.searchRoutePolicy } : {}),
    },
  };
  return { previous, delegateProvider };
}

describe('createSettingsSnapshot', () => {
  it('produces a stable revision for identical config and different revisions for changes', () => {
    const base: PiwinConfig = {
      hostMode: 'sdk',
      agentMock: false,
      providers: [],
      media: { maxPasteBytes: 100, allowedMimeTypes: ['image/png'] },
      artifact: {
        enabled: true,
        triggerMode: 'automatic',
        decisionPrompt: { mode: 'default', customPrompt: '' },
        maxBytes: 100,
      },
    };
    const snapshotOne = createSettingsSnapshot(base);
    const snapshotTwo = createSettingsSnapshot(base);
    expect(snapshotOne.revision).toBe(snapshotTwo.revision);

    const changed = createSettingsSnapshot({ ...base, hostMode: 'rpc' });
    expect(changed.revision).not.toBe(snapshotOne.revision);
  });

  it('keeps the runtime revision stable for Desktop-only persistence', () => {
    const base: PiwinConfig = {
      hostMode: 'sdk',
      agentMock: false,
      providers: [],
      media: { maxPasteBytes: 100, allowedMimeTypes: ['image/png'] },
      artifact: {
        enabled: true,
        triggerMode: 'automatic',
        decisionPrompt: { mode: 'default', customPrompt: '' },
        maxBytes: 100,
      },
    };
    const initial = createSettingsSnapshot(base);
    const withComposerState = createSettingsSnapshot({
      ...base,
      desktop: { composerProfile: { thinkingLevel: 'high' } },
    });

    expect(withComposerState.revision).not.toBe(initial.revision);
    expect(withComposerState.runtimeRevision).toBe(initial.runtimeRevision);
  });

  it('changes the runtime revision when a Provider changes', () => {
    const base = createSettingsSnapshot(undefined as unknown as PiwinConfig);
    const changed = createSettingsSnapshot({
      ...base.config,
      providers: [
        {
          id: 'provider-a',
          protocol: 'openai-compatible',
          name: 'Provider A',
          baseUrl: 'https://example.test/v1',
          models: [{ id: 'model-a' }],
        },
      ],
    });

    expect(changed.runtimeRevision).not.toBe(base.runtimeRevision);
  });

  it('normalizes the config before hashing so equivalent drafts hash identically', () => {
    const normalized: PiwinConfig = {
      hostMode: 'sdk',
      agentMock: false,
      providers: [],
      media: { maxPasteBytes: 100, allowedMimeTypes: ['image/png'] },
      artifact: {
        enabled: true,
        triggerMode: 'automatic',
        decisionPrompt: { mode: 'default', customPrompt: '' },
        maxBytes: 100,
      },
    };
    const snapshot = createSettingsSnapshot(normalized);
    expect(snapshot.schemaVersion).toBe(PIWIN_SETTINGS_SCHEMA_VERSION);
    expect(snapshot.config.web).toBeDefined();
  });
});

describe('applySettingsMutations', () => {
  it('applies only the mutated domains and preserves the rest', () => {
    const base = createSettingsSnapshot(undefined as unknown as PiwinConfig).config;
    const next = applySettingsMutations(base, [mutation('automation', { enabled: true })]);
    expect(next.automation?.enabled).toBe(true);
    expect(next.web).toEqual(base.web);
  });

  it('keeps a CLI search command when the shell apply omitted it in another source order', () => {
    const base = createSettingsSnapshot(undefined as unknown as PiwinConfig).config;
    const currentWeb = base.web;
    if (currentWeb === undefined) {
      throw new Error('default web config missing');
    }
    const withCli = {
      ...currentWeb,
      searchSources: [
        { id: 'duckduckgo', kind: 'duckduckgo' as const, enabled: false },
        {
          id: 'cli',
          kind: 'cli' as const,
          enabled: true,
          command: '/usr/bin/node',
          args: ['/tmp/search.mjs', '{{query}}'],
        },
      ],
    };
    const next = applySettingsMutations(
      { ...base, web: withCli },
      [
        mutation('web', {
          ...currentWeb,
          fetchReturnMaxChars: 12_000,
          searchSources: [
            { id: 'cli', kind: 'cli', enabled: true },
            { id: 'duckduckgo', kind: 'duckduckgo', enabled: false },
          ],
        }),
      ],
    );
    expect(next.web?.fetchReturnMaxChars).toBe(12_000);
    expect(next.web?.searchSources).toEqual([
      {
        id: 'cli',
        kind: 'cli',
        enabled: true,
        command: '/usr/bin/node',
        args: ['/tmp/search.mjs', '{{query}}'],
      },
      { id: 'duckduckgo', kind: 'duckduckgo', enabled: false },
    ]);
  });

  it('keeps a Host CLI source when a projected apply only sent the default DuckDuckGo row', () => {
    const base = createSettingsSnapshot(undefined as unknown as PiwinConfig).config;
    const currentWeb = base.web;
    if (currentWeb === undefined) {
      throw new Error('default web config missing');
    }
    const withCli = {
      ...currentWeb,
      searchSources: [
        { id: 'duckduckgo', kind: 'duckduckgo' as const, enabled: false },
        {
          id: 'cli',
          kind: 'cli' as const,
          enabled: true,
          command: '/usr/bin/node',
          args: ['/Users/private/.piwin/bin/search.mjs', '{{query}}'],
        },
      ],
    };
    const next = applySettingsMutations(
      { ...base, web: withCli },
      [
        mutation('web', {
          ...currentWeb,
          fetchReturnMaxChars: 18_000,
          searchSources: [{ id: 'duckduckgo', kind: 'duckduckgo', enabled: true }],
        }),
      ],
    );
    expect(next.web?.searchSources).toEqual([
      { id: 'duckduckgo', kind: 'duckduckgo', enabled: true },
      {
        id: 'cli',
        kind: 'cli',
        enabled: true,
        command: '/usr/bin/node',
        args: ['/Users/private/.piwin/bin/search.mjs', '{{query}}'],
      },
    ]);
  });

  it('does not persist a redacted Host path sent back by a remote shell', () => {
    const base = createSettingsSnapshot(undefined as unknown as PiwinConfig).config;
    const currentWeb = base.web;
    if (currentWeb === undefined) {
      throw new Error('default web config missing');
    }
    const withCli = {
      ...currentWeb,
      searchSources: [
        {
          id: 'cli',
          kind: 'cli' as const,
          enabled: true,
          command: '/usr/bin/node',
          args: ['/Users/private/.piwin/bin/search.mjs', '{{query}}'],
        },
      ],
    };
    const next = applySettingsMutations(
      { ...base, web: withCli },
      [
        mutation('web', {
          ...currentWeb,
          searchSources: [
            {
              id: 'cli',
              kind: 'cli',
              enabled: true,
              args: ['[host-path]', '{{query}}'],
            },
          ],
        }),
      ],
    );
    expect(next.web?.searchSources).toEqual([
      {
        id: 'cli',
        kind: 'cli',
        enabled: true,
        command: '/usr/bin/node',
        args: ['/Users/private/.piwin/bin/search.mjs', '{{query}}'],
      },
    ]);
  });

  it('keeps Host provider secret refs when the remote shell sends a redacted placeholder', () => {
    const base = createSettingsSnapshot(undefined as unknown as PiwinConfig).config;
    const currentProviders = [
      {
        id: 'custom-openai',
        protocol: 'openai-compatible' as const,
        name: 'Cpa',
        baseUrl: 'http://127.0.0.1:8317/v1',
        apiKeyRef: 'keychain:piwin-custom-openai',
        models: [{ id: 'win/glm5.2' }],
      },
    ];
    const next = applySettingsMutations(
      { ...base, providers: currentProviders },
      [
        mutation('providers', [
          {
            id: 'custom-openai',
            protocol: 'openai-compatible',
            name: 'Cpa',
            baseUrl: 'http://127.0.0.1:8317/v1',
            apiKeyRef: '[stored-secret]',
            models: [{ id: 'win/glm5.2' }, { id: 'muse-spark-1.2' }],
          },
        ]),
      ],
    );
    expect(next.providers[0]?.apiKeyRef).toBe('keychain:piwin-custom-openai');
    expect(next.providers[0]?.models.map((model) => model.id)).toEqual([
      'win/glm5.2',
      'muse-spark-1.2',
    ]);
  });

  it('deletes a provider that holds an apiKeyRef when the shell omits that row', () => {
    const base = createSettingsSnapshot(undefined as unknown as PiwinConfig).config;
    const currentProviders = [
      {
        id: 'custom-openai',
        protocol: 'openai-compatible' as const,
        name: 'Cpa',
        baseUrl: 'http://127.0.0.1:8317/v1',
        apiKeyRef: 'keychain:piwin-custom-openai',
        models: [{ id: 'win/glm5.2' }],
      },
      {
        id: 'keep-me',
        protocol: 'openai-compatible' as const,
        name: 'Keep',
        baseUrl: 'https://api.example.com/v1',
        apiKeyEnv: 'KEEP_API_KEY',
        models: [{ id: 'keep-1' }],
      },
    ];
    const next = applySettingsMutations(
      { ...base, providers: currentProviders },
      [
        mutation('providers', [
          {
            id: 'keep-me',
            protocol: 'openai-compatible',
            name: 'Keep',
            baseUrl: 'https://api.example.com/v1',
            apiKeyEnv: '[stored-secret]',
            models: [{ id: 'keep-1' }],
          },
        ]),
      ],
    );
    expect(next.providers.map((provider) => provider.id)).toEqual(['keep-me']);
    expect(next.providers[0]?.apiKeyEnv).toBe('KEEP_API_KEY');
  });

  it('keeps omitted secret fields when replacing a projected web domain', () => {
    const base = createSettingsSnapshot(undefined as unknown as PiwinConfig).config;
    const currentWeb = base.web;
    if (currentWeb === undefined) {
      throw new Error('default web config missing');
    }
    const { searchApiKeyEnv: _searchApiKeyEnv, ...projected } = currentWeb;
    const next = applySettingsMutations(base, [
      mutation('web', { ...projected, searchMaxResults: currentWeb.searchMaxResults + 2 }),
    ]);
    expect(next.web?.searchMaxResults).toBe(currentWeb.searchMaxResults + 2);
    expect(next.web?.searchApiKeyEnv).toBe(currentWeb.searchApiKeyEnv);
  });

  it('rejects unknown mutation kinds at the type level and ignores unknown domains', () => {
    const base = createSettingsSnapshot(undefined as unknown as PiwinConfig).config;
    const next = applySettingsMutations(base, [
      { kind: 'replace-domain', domain: 'process', value: { enabled: false } },
    ]);
    expect(next.process?.enabled).toBe(false);
  });
});

describe('SettingsService', () => {
  it('getSnapshot reads the persisted config and computes a revision', async () => {
    const service = new SettingsService({ piwinRoot });
    const snapshot = await service.getSnapshot();
    expect(snapshot.schemaVersion).toBe(PIWIN_SETTINGS_SCHEMA_VERSION);
    expect(snapshot.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.config.hostMode).toBe('sdk');
  });

  it('apply persists the mutated config and bumps the revision', async () => {
    const service = new SettingsService({ piwinRoot });
    const before = await service.getSnapshot();
    const result = await service.apply({
      expectedRevision: before.revision,
      mutations: [mutation('automation', { enabled: true })],
    });
    expect(result.snapshot.revision).not.toBe(before.revision);
    expect(result.snapshot.config.automation?.enabled).toBe(true);
    expect(result.changedDomains).toContainEqual(
      expect.objectContaining({ domain: 'automation', timing: 'immediate' }),
    );

    const reloaded = await service.getSnapshot();
    expect(reloaded.revision).toBe(result.snapshot.revision);
    expect(reloaded.config.automation?.enabled).toBe(true);
  });

  it('persists deletion of a provider that holds a stored secret ref', async () => {
    const service = new SettingsService({ piwinRoot });
    const before = await service.getSnapshot();
    const created = await service.apply({
      expectedRevision: before.revision,
      mutations: [
        mutation('providers', [
          {
            id: 'cpa',
            protocol: 'openai-compatible',
            name: 'CPA',
            baseUrl: 'http://127.0.0.1:8317/v1',
            apiKeyRef: 'keychain:piwin-cpa',
            models: [],
          },
        ]),
      ],
    });
    expect(created.snapshot.config.providers.map((provider) => provider.id)).toEqual(['cpa']);

    const removed = await service.apply({
      expectedRevision: created.snapshot.revision,
      mutations: [mutation('providers', [])],
    });
    expect(removed.snapshot.config.providers).toEqual([]);
    const reloaded = await service.getSnapshot();
    expect(reloaded.config.providers).toEqual([]);
  });

  it('does not mark a Web source switch as an immediate tightening', async () => {
    const service = new SettingsService({ piwinRoot });
    const before = await service.getSnapshot();
    const currentWeb = before.config.web;
    if (!currentWeb) throw new Error('default Web config missing');
    const result = await service.apply({
      expectedRevision: before.revision,
      mutations: [
        mutation('web', {
          ...currentWeb,
          searchProvider: 'cli',
          searchSources: [{ id: 'cli', kind: 'cli', enabled: true }],
          searchDelegateModel: undefined,
        }),
      ],
    });
    expect(result.changedDomains).toContainEqual(
      expect.objectContaining({
        domain: 'web',
        timing: 'new-runtime',
        runtimeSchemaChanged: true,
        immediateRestrictions: [],
        securityTightenedImmediately: false,
      }),
    );
  });

  it('marks an equal-length blocked URL prefix replacement as a Web fetch tightening', async () => {
    const snapshot = await new SettingsService({ piwinRoot }).getSnapshot();
    const web = snapshot.config.web;
    if (!web) throw new Error('default Web config missing');

    const impact = classifySettingsImpact(
      'web',
      {
        ...snapshot.config,
        web: { ...web, fetchBlockedUrlPrefixes: ['https://old.example/'] },
      },
      {
        ...snapshot.config,
        web: { ...web, fetchBlockedUrlPrefixes: ['https://new.example/'] },
      },
    );

    expect(impact.immediateRestrictions).toContain('web-fetch');
    expect(impact.securityTightenedImmediately).toBe(true);
  });

  it('tightens Web search immediately when the native delegate becomes unusable', async () => {
    const snapshot = await new SettingsService({ piwinRoot }).getSnapshot();
    const delegateModel: NonNullable<PiwinConfig['providers']>[number]['models'][number] = {
      id: 'search-m',
      label: 'Search',
      enabled: true,
      capabilities: ['chat', 'native-web-search'],
    };
    const delegateProvider: NonNullable<PiwinConfig['providers']>[number] = {
      id: 'search-p',
      protocol: 'openai-compatible',
      name: 'Search',
      baseUrl: 'https://example.test/v1',
      enabled: true,
      models: [delegateModel],
    };
    const delegateRef = {
      protocol: 'openai-compatible' as const,
      providerId: 'search-p',
      modelId: 'search-m',
    };
    const previous: PiwinConfig = {
      ...snapshot.config,
      providers: [delegateProvider],
      web: {
        ...(snapshot.config.web ?? ({} as NonNullable<PiwinConfig['web']>)),
        searchProvider: 'none',
        searchSources: [],
        searchDelegateModel: delegateRef,
      },
    };
    // Same stale delegate reference, but its provider is gone: usable web
    // search flips true → false and must restrict the live generation now,
    // before the replacement runtime completes.
    const next: PiwinConfig = { ...previous, providers: [] };

    const impact = classifySettingsImpact('web', previous, next);
    expect(impact.immediateRestrictions).toContain('web-search');
    expect(impact.securityTightenedImmediately).toBe(true);
  });

  it('does not tighten Web search when the native delegate stays ready', async () => {
    const snapshot = await new SettingsService({ piwinRoot }).getSnapshot();
    const delegateModel: NonNullable<PiwinConfig['providers']>[number]['models'][number] = {
      id: 'search-m',
      enabled: true,
      capabilities: ['chat', 'native-web-search'],
    };
    const delegateProvider: NonNullable<PiwinConfig['providers']>[number] = {
      id: 'search-p',
      protocol: 'openai-compatible',
      name: 'Search',
      baseUrl: 'https://example.test/v1',
      enabled: true,
      models: [delegateModel],
    };
    const previous: PiwinConfig = {
      ...snapshot.config,
      providers: [delegateProvider],
      web: {
        ...(snapshot.config.web ?? ({} as NonNullable<PiwinConfig['web']>)),
        searchProvider: 'none',
        searchSources: [],
        searchDelegateModel: {
          protocol: 'openai-compatible',
          providerId: 'search-p',
          modelId: 'search-m',
        },
      },
    };
    const next: PiwinConfig = {
      ...previous,
      web: { ...(previous.web ?? ({} as NonNullable<PiwinConfig['web']>)), searchSources: [] },
    };

    const impact = classifySettingsImpact('web', previous, next);
    expect(impact.immediateRestrictions).toEqual([]);
  });

  it('tightens Web search when a providers mutation removes the delegate model', async () => {
    const snapshot = await new SettingsService({ piwinRoot }).getSnapshot();
    const { previous } = delegateBackedConfig(snapshot.config, { searchSources: [] });
    // Deleting the delegate's provider is a `providers` mutation — the real
    // user path in the settings UI — and must restrict live generations just
    // like the equivalent `web` mutation.
    const next: PiwinConfig = { ...previous, providers: [] };

    const impact = classifySettingsImpact('providers', previous, next);
    expect(impact.immediateRestrictions).toContain('web-search');
    expect(impact.securityTightenedImmediately).toBe(true);
  });

  it('tightens Web search when the delegate goes stale even though external sources stay enabled', async () => {
    const snapshot = await new SettingsService({ piwinRoot }).getSnapshot();
    const { previous } = delegateBackedConfig(snapshot.config, {
      searchSources: [{ id: 'cli', kind: 'cli', enabled: true }],
    });
    // A configured delegate is the exclusive web_search backend (fail-closed
    // when stale); enabled ordinary sources must not mask the revocation.
    const next: PiwinConfig = { ...previous, providers: [] };

    const impact = classifySettingsImpact('providers', previous, next);
    expect(impact.immediateRestrictions).toContain('web-search');
  });

  it('does not tighten Web search when a providers mutation leaves the delegate ready', async () => {
    const snapshot = await new SettingsService({ piwinRoot }).getSnapshot();
    const { previous, delegateProvider } = delegateBackedConfig(snapshot.config, {
      searchSources: [],
    });
    const unrelatedProvider: NonNullable<PiwinConfig['providers']>[number] = {
      id: 'other-p',
      protocol: 'openai-compatible',
      name: 'Other',
      baseUrl: 'https://other.example/v1',
      enabled: true,
      models: [{ id: 'other-m', enabled: true, capabilities: ['chat'] }],
    };
    const withUnrelated: PiwinConfig = {
      ...previous,
      providers: [delegateProvider, unrelatedProvider],
    };
    const next: PiwinConfig = { ...withUnrelated, providers: [delegateProvider] };

    const impact = classifySettingsImpact('providers', withUnrelated, next);
    expect(impact.immediateRestrictions).toEqual([]);
  });

  it('does not tighten Web search under a native-only policy where the external tool is never exposed', async () => {
    const snapshot = await new SettingsService({ piwinRoot }).getSnapshot();
    const { previous } = delegateBackedConfig(snapshot.config, {
      searchSources: [{ id: 'cli', kind: 'cli', enabled: true }],
      searchRoutePolicy: 'native-only',
    });
    const next: PiwinConfig = { ...previous, providers: [] };

    const impact = classifySettingsImpact('providers', previous, next);
    expect(impact.immediateRestrictions).toEqual([]);
  });

  it('rejects a stale expectedRevision with a typed conflict error', async () => {
    const service = new SettingsService({ piwinRoot });
    const before = await service.getSnapshot();
    await service.apply({
      expectedRevision: before.revision,
      mutations: [
        mutation('web', {
          ...(before.config.web ?? {}),
          searchMaxResults: 3,
          searchProvider: 'none',
          searchSources: [],
        }),
      ],
    });
    const staleApply = service.apply({
      expectedRevision: before.revision,
      mutations: [mutation('automation', { enabled: true })],
    });
    await expect(staleApply).rejects.toBeInstanceOf(SettingsRevisionConflictError);
  });

  it('rebases non-overlapping writes across SettingsService instances on one root', async () => {
    const firstService = new SettingsService({ piwinRoot });
    const secondService = new SettingsService({ piwinRoot });
    const first = await firstService.getSnapshot();
    const thinkingHash = first.domainRevisions.thinking;
    const webHash = first.domainRevisions.web;
    const currentWeb = first.config.web;
    if (thinkingHash === undefined || webHash === undefined || currentWeb === undefined) {
      throw new Error('expected thinking/web hashes');
    }
    const results = await Promise.allSettled([
      firstService.apply({
        expectedRevision: first.revision,
        expectedDomainRevisions: { thinking: thinkingHash },
        mutations: [{ kind: 'replace-domain', domain: 'thinking', value: { ultraEnabled: true } }],
      }),
      secondService.apply({
        expectedRevision: first.revision,
        expectedDomainRevisions: { web: webHash },
        mutations: [
          {
            kind: 'replace-domain',
            domain: 'web',
            value: { ...currentWeb, searchMaxResults: currentWeb.searchMaxResults + 1 },
          },
        ],
      }),
    ]);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    const finalConfig = (await firstService.getSnapshot()).config;
    expect(finalConfig.thinking?.ultraEnabled).toBe(true);
    expect(finalConfig.web?.searchMaxResults).toBe(currentWeb.searchMaxResults + 1);
  });

  it('rebases non-overlapping domain writes from the same document revision', async () => {
    const service = new SettingsService({ piwinRoot });
    const first = await service.getSnapshot();
    const permissionsHash = first.domainRevisions.permissions;
    const webHash = first.domainRevisions.web;
    expect(permissionsHash).toBeTruthy();
    expect(webHash).toBeTruthy();
    if (permissionsHash === undefined || webHash === undefined) {
      throw new Error('expected domain hashes');
    }
    const firstWrite = service.apply({
      expectedRevision: first.revision,
      expectedDomainRevisions: { permissions: permissionsHash },
      mutations: [mutation('permissions', { mode: 'auto', preset: 'auto' })],
    });
    const secondWrite = service.apply({
      expectedRevision: first.revision,
      expectedDomainRevisions: { web: webHash },
      mutations: [mutation('web', { searchProvider: 'duckduckgo', searchSources: [] })],
    });
    const results = await Promise.allSettled([firstWrite, secondWrite]);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);

    const finalConfig = (await service.getSnapshot()).config;
    expect(finalConfig.permissions?.mode).toBe('auto');
    expect(finalConfig.web?.searchProvider).toBe('duckduckgo');
  });

  it('rejects overlapping domain writes from the same document revision', async () => {
    const service = new SettingsService({ piwinRoot });
    const first = await service.getSnapshot();
    const permissionsHash = first.domainRevisions.permissions;
    expect(permissionsHash).toBeTruthy();
    if (permissionsHash === undefined) {
      throw new Error('expected permissions hash');
    }
    const firstWrite = service.apply({
      expectedRevision: first.revision,
      expectedDomainRevisions: { permissions: permissionsHash },
      mutations: [mutation('permissions', { mode: 'auto', preset: 'auto' })],
    });
    const secondWrite = service.apply({
      expectedRevision: first.revision,
      expectedDomainRevisions: { permissions: permissionsHash },
      mutations: [mutation('permissions', { mode: 'ask-all', preset: 'ask-all' })],
    });
    const results = await Promise.allSettled([firstWrite, secondWrite]);
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(SettingsRevisionConflictError);
    expect((rejected[0]?.reason as SettingsRevisionConflictError).conflictingDomains).toEqual([
      'permissions',
    ]);
  });

  it('no-op when mutations do not change the normalized config', async () => {
    const service = new SettingsService({ piwinRoot });
    const before = await service.getSnapshot();
    const result = await service.apply({
      expectedRevision: before.revision,
      mutations: [mutation('automation', { enabled: false })],
    });
    expect(result.changedDomains).toEqual([]);
    expect(result.snapshot.revision).toBe(before.revision);
  });

  it('writes the config file atomically with the schemaVersion header', async () => {
    const service = new SettingsService({ piwinRoot });
    const before = await service.getSnapshot();
    await service.apply({
      expectedRevision: before.revision,
      mutations: [mutation('automation', { enabled: true })],
    });
    const raw = await readFile(getPiwinConfigPath(piwinRoot), 'utf8');
    const parsed = JSON.parse(raw) as {
      schemaVersion?: number;
      automation?: { enabled?: boolean };
    };
    expect(parsed.schemaVersion).toBe(PIWIN_SETTINGS_SCHEMA_VERSION);
    expect(parsed.automation?.enabled).toBe(true);
  });

  it('persists knowledge domain mutations atomically', async () => {
    const service = new SettingsService({ piwinRoot });
    const before = await service.getSnapshot();
    const result = await service.apply({
      expectedRevision: before.revision,
      mutations: [
        {
          kind: 'replace-domain',
          domain: 'knowledge',
          value: {
            embedding: {
              enabled: true,
              provider: 'openai-compatible',
              baseUrl: 'https://api.openai.com/v1',
              model: 'text-embedding-3-small',
            },
            reranker: {
              enabled: true,
              provider: 'openai-compatible',
              baseUrl: 'https://api.example.com/v1',
              model: 'rerank-v1',
            },
          },
        },
      ],
    });
    expect(result.snapshot.config.knowledge?.embedding).toMatchObject({
      enabled: true,
      model: 'text-embedding-3-small',
    });
    expect(result.snapshot.config.knowledge?.reranker).toMatchObject({
      enabled: true,
      model: 'rerank-v1',
    });
    const raw = await readFile(getPiwinConfigPath(piwinRoot), 'utf8');
    const parsed = JSON.parse(raw) as {
      knowledge?: {
        embedding?: { model?: string };
        reranker?: { model?: string };
      };
    };
    expect(parsed.knowledge?.embedding?.model).toBe('text-embedding-3-small');
    expect(parsed.knowledge?.reranker?.model).toBe('rerank-v1');
  });

  it('lifts notes.knowledgeExtras into knowledge when applying notes', async () => {
    const service = new SettingsService({ piwinRoot });
    const before = await service.getSnapshot();
    const result = await service.apply({
      expectedRevision: before.revision,
      mutations: [
        {
          kind: 'replace-domain',
          domain: 'notes',
          value: {
            embedding: {
              provider: 'openai-compatible',
              baseUrl: 'https://api.openai.com/v1',
              model: 'text-embedding-3-small',
            },
            knowledgeExtras: {
              reranker: {
                enabled: true,
                provider: 'openai-compatible',
                baseUrl: 'https://api.example.com/v1',
                model: 'Qwen/Qwen3-Reranker-8B',
              },
            },
          },
        },
      ],
    });
    expect(result.snapshot.config.notes?.knowledgeExtras?.reranker).toMatchObject({
      enabled: true,
      model: 'Qwen/Qwen3-Reranker-8B',
    });
    expect(result.snapshot.config.knowledge?.reranker).toMatchObject({
      enabled: true,
      model: 'Qwen/Qwen3-Reranker-8B',
    });
  });
});

describe('migrateSettingsDocument', () => {
  it('creates a default document when the config file is missing', async () => {
    const snapshot = await migrateSettingsDocument(piwinRoot);
    expect(snapshot.config.hostMode).toBe('sdk');
    const raw = await readFile(getPiwinConfigPath(piwinRoot), 'utf8');
    expect(JSON.parse(raw)).toMatchObject({ schemaVersion: PIWIN_SETTINGS_SCHEMA_VERSION });
  });

  it('normalizes an existing legacy document without losing known fields', async () => {
    const configPath = getPiwinConfigPath(piwinRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        hostMode: 'rpc',
        providers: [],
        web: { searchProvider: 'duckduckgo' },
      }),
      'utf8',
    );
    const snapshot = await migrateSettingsDocument(piwinRoot);
    expect(snapshot.config.hostMode).toBe('rpc');
    expect(snapshot.config.web?.searchProvider).toBe('duckduckgo');
    const raw = JSON.parse(await readFile(configPath, 'utf8')) as { schemaVersion?: number };
    expect(raw.schemaVersion).toBe(PIWIN_SETTINGS_SCHEMA_VERSION);
  });
});

describe('codeSearch settings domain', () => {
  it('persists codeSearch through settings/apply-style domain replace', async () => {
    const service = new SettingsService({ piwinRoot });
    const before = await service.getSnapshot();
    const result = await service.apply({
      expectedRevision: before.revision,
      expectedDomainRevisions: {
        ...(before.domainRevisions.codeSearch
          ? { codeSearch: before.domainRevisions.codeSearch }
          : {}),
      },
      mutations: [
        {
          kind: 'replace-domain',
          domain: 'codeSearch',
          value: {
            enabled: true,
            backend: 'windsurf',
            apiKeyRef: 'keychain:piwin-code-search-windsurf',
            maxTurns: 3,
          },
        },
      ],
    });
    expect(result.changedDomains.map((entry) => entry.domain)).toContain('codeSearch');
    expect(result.snapshot.config.codeSearch).toEqual({
      enabled: true,
      backend: 'windsurf',
      apiKeyRef: 'keychain:piwin-code-search-windsurf',
      maxTurns: 3,
    });
    const raw = JSON.parse(await readFile(getPiwinConfigPath(piwinRoot), 'utf8')) as {
      config?: { codeSearch?: unknown };
      codeSearch?: unknown;
    };
    // V2 settings document nests under config.
    const stored = raw.config?.codeSearch ?? raw.codeSearch;
    expect(stored).toEqual({
      enabled: true,
      backend: 'windsurf',
      apiKeyRef: 'keychain:piwin-code-search-windsurf',
      maxTurns: 3,
    });
  });
});
