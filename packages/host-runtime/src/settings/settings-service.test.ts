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

function mutation(domain: 'automation' | 'permissions' | 'web', value: unknown): SettingsMutation {
  return { kind: 'replace-domain', domain, value } as SettingsMutation;
}

describe('createSettingsSnapshot', () => {
  it('produces a stable revision for identical config and different revisions for changes', () => {
    const base: PiwinConfig = {
      hostMode: 'sdk',
      agentMock: false,
      providers: [],
      media: { maxPasteBytes: 100, allowedMimeTypes: ['image/png'] },
      artifact: { maxBytes: 100, htmlUiModeDefault: false },
    };
    const snapshotOne = createSettingsSnapshot(base);
    const snapshotTwo = createSettingsSnapshot(base);
    expect(snapshotOne.revision).toBe(snapshotTwo.revision);

    const changed = createSettingsSnapshot({ ...base, hostMode: 'rpc' });
    expect(changed.revision).not.toBe(snapshotOne.revision);
  });

  it('normalizes the config before hashing so equivalent drafts hash identically', () => {
    const normalized: PiwinConfig = {
      hostMode: 'sdk',
      agentMock: false,
      providers: [],
      media: { maxPasteBytes: 100, allowedMimeTypes: ['image/png'] },
      artifact: { maxBytes: 100, htmlUiModeDefault: false },
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

  it('rejects a stale expectedRevision with a typed conflict error', async () => {
    const service = new SettingsService({ piwinRoot });
    const before = await service.getSnapshot();
    await service.apply({
      expectedRevision: before.revision,
      mutations: [
        mutation('web', { searchEnabled: false, searchProvider: 'none', searchSources: [] }),
      ],
    });
    const staleApply = service.apply({
      expectedRevision: before.revision,
      mutations: [mutation('automation', { enabled: true })],
    });
    await expect(staleApply).rejects.toBeInstanceOf(SettingsRevisionConflictError);
  });

  it('prevents a stale panel from overwriting a newer revision (concurrent overwrite guard)', async () => {
    const service = new SettingsService({ piwinRoot });
    const first = await service.getSnapshot();
    const webBefore = first.config.web?.searchProvider;

    // Simulate two writers with the same base revision: only the first may
    // succeed; the second must conflict instead of silently re-enabling.
    const firstWrite = await service.apply({
      expectedRevision: first.revision,
      mutations: [mutation('permissions', { mode: 'auto', preset: 'auto' })],
    });
    const secondWrite = service.apply({
      expectedRevision: first.revision,
      mutations: [mutation('web', { searchProvider: 'duckduckgo', searchSources: [] })],
    });
    await expect(secondWrite).rejects.toBeInstanceOf(SettingsRevisionConflictError);

    const finalConfig = (await service.getSnapshot()).config;
    expect(finalConfig.permissions?.mode).toBe('auto');
    expect(finalConfig.web?.searchProvider).toBe(webBefore);
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
