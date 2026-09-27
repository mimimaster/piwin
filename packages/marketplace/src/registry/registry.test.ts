import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parseRegistryIndex } from './parse-registry-index.js';
import { createRegistryIndexLoader } from './registry-index-loader.js';
import { parseRegistryReference, resolveRegistryInstall } from './resolve-registry-install.js';
import { searchRegistryIndex } from './search-registry.js';

const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);
const COMMIT_C = 'c'.repeat(40);

/** Golden fixture shared in spirit with the registry repo's `schema/`. */
function fixtureIndex(): unknown {
  return {
    schemaVersion: 1,
    generatedAt: '2026-09-27T00:00:00Z',
    extensions: [
      {
        id: 'alice/git-autopilot',
        name: 'Git Autopilot',
        description: 'Stages and commits with generated messages.',
        owners: ['Alice'],
        repository: 'https://github.com/alice/git-autopilot.git',
        subdir: './extension/',
        license: 'MIT',
        keywords: ['git', 'Commit'],
        versions: [
          { version: '1.2.0', commit: COMMIT_B, yanked: { reason: 'breaks rebase' } },
          { version: '1.1.0', commit: COMMIT_A.toUpperCase() },
        ],
      },
      {
        id: 'yorick/git-autopilot',
        name: 'Git Autopilot (Chinese messages)',
        description: 'Fork that writes commit messages in Chinese.',
        owners: ['yorick'],
        repository: 'https://github.com/yorick/git-autopilot',
        license: 'MIT',
        forkOf: { id: 'alice/git-autopilot', version: '1.1.0' },
        versions: [{ version: '1.1.0-zh.1', commit: COMMIT_C }],
      },
      { id: 'bad', name: 'no owner segment' },
      {
        id: 'mallory/escape',
        name: 'Escape',
        owners: ['mallory'],
        repository: 'https://github.com/mallory/escape',
        subdir: '../../etc',
        license: 'MIT',
        versions: [{ version: '1.0.0', commit: COMMIT_A }],
      },
      {
        id: 'mallory/moving',
        name: 'Moving tag',
        owners: ['mallory'],
        repository: 'https://github.com/mallory/moving',
        license: 'MIT',
        versions: [{ version: '1.0.0', commit: 'main' }],
      },
    ],
  };
}

describe('parseRegistryIndex', () => {
  it('normalizes valid entries and drops invalid ones with diagnostics', () => {
    const { index, diagnostics } = parseRegistryIndex(fixtureIndex());
    expect(index.extensions.map((entry) => entry.id)).toEqual([
      'alice/git-autopilot',
      'yorick/git-autopilot',
    ]);
    const alice = index.extensions[0];
    expect(alice?.owners).toEqual(['alice']);
    expect(alice?.repository).toBe('https://github.com/alice/git-autopilot');
    expect(alice?.subdir).toBe('extension');
    expect(alice?.keywords).toEqual(['git', 'commit']);
    expect(alice?.versions[1]?.commit).toBe(COMMIT_A);
    expect(diagnostics).toHaveLength(3);
    expect(diagnostics.join('\n')).toMatch(/subdir/);
    expect(diagnostics.join('\n')).toMatch(/40-hex/);
  });

  it('reads the exact output of the registry repo build-index script', () => {
    // piwin-extensions `node scripts/build-index.mjs schema/fixtures/valid`; keep in sync.
    const built: unknown = JSON.parse(
      readFileSync(new URL('./fixtures/build-index-output.json', import.meta.url), 'utf8'),
    );
    const { index, diagnostics } = parseRegistryIndex(built);
    expect(diagnostics).toEqual([]);
    expect(index.extensions.map((entry) => entry.id)).toEqual([
      'acme/minimal',
      'alice/git-autopilot',
      'yorick/git-autopilot',
    ]);
    // build-index sorts newest first; the resolver relies on it.
    expect(index.extensions[1]?.versions.map((version) => version.version)).toEqual(['1.2.0', '1.1.0']);
  });

  it('rejects an unknown schema version as a whole', () => {
    expect(() => parseRegistryIndex({ schemaVersion: 2, extensions: [] })).toThrow(/schemaVersion/);
  });

  it('rejects a fork that names itself', () => {
    const { index, diagnostics } = parseRegistryIndex({
      schemaVersion: 1,
      extensions: [
        {
          id: 'a/b',
          name: 'B',
          owners: ['a'],
          repository: 'https://github.com/a/b',
          license: 'MIT',
          forkOf: { id: 'a/b', version: '1.0.0' },
          versions: [{ version: '1.0.0', commit: COMMIT_A }],
        },
      ],
    });
    expect(index.extensions).toEqual([]);
    expect(diagnostics[0]).toMatch(/itself/);
  });
});

describe('searchRegistryIndex', () => {
  const { index } = parseRegistryIndex(fixtureIndex());

  it('ranks name matches first and shows the newest non-yanked version', () => {
    const hits = searchRegistryIndex(index, 'git autopilot');
    expect(hits.map((hit) => hit.entryId)).toEqual([
      'registry:alice/git-autopilot',
      'registry:yorick/git-autopilot',
    ]);
    expect(hits[0]?.version).toBe('1.1.0');
    expect(hits[0]?.registry?.commit).toBe(COMMIT_A);
    expect(hits[0]?.installCommand).toBe(
      'piwin extension install --registry alice/git-autopilot@1.1.0',
    );
    expect(hits[1]?.registry?.forkOf).toEqual({ id: 'alice/git-autopilot', version: '1.1.0' });
  });

  it('requires every token to match', () => {
    expect(searchRegistryIndex(index, 'git kubernetes')).toEqual([]);
    expect(searchRegistryIndex(index, 'chinese').map((hit) => hit.entryId)).toEqual([
      'registry:yorick/git-autopilot',
    ]);
  });
});

describe('resolveRegistryInstall', () => {
  const { index } = parseRegistryIndex(fixtureIndex());

  it('resolves the newest non-yanked version to a pinned source', () => {
    expect(resolveRegistryInstall(index, { id: 'Alice/Git-Autopilot' })).toEqual({
      id: 'alice/git-autopilot',
      version: '1.1.0',
      repository: 'https://github.com/alice/git-autopilot',
      subdir: 'extension',
      commit: COMMIT_A,
      installName: 'alice-git-autopilot',
      sourceLocator: `registry:alice/git-autopilot@1.1.0 git:https://github.com/alice/git-autopilot@${COMMIT_A}`,
    });
  });

  it('refuses yanked, unknown and malformed references', () => {
    expect(() => resolveRegistryInstall(index, { id: 'alice/git-autopilot', version: '1.2.0' })).toThrow(
      /yanked: breaks rebase/,
    );
    expect(() => resolveRegistryInstall(index, { id: 'alice/git-autopilot', version: '9.9.9' })).toThrow(
      /no version 9.9.9/,
    );
    expect(() => resolveRegistryInstall(index, { id: 'nobody/nothing' })).toThrow(/not in the registry/);
    expect(() => resolveRegistryInstall(index, { id: 'no-slash' })).toThrow(/<owner>\/<name>/);
  });

  it('parses CLI references with and without a version', () => {
    expect(parseRegistryReference('alice/git-autopilot@1.1.0')).toEqual({
      id: 'alice/git-autopilot',
      version: '1.1.0',
    });
    expect(parseRegistryReference(' alice/git-autopilot ')).toEqual({ id: 'alice/git-autopilot' });
  });
});

describe('createRegistryIndexLoader', () => {
  it('caches a successful load until the TTL expires', async () => {
    let clock = 0;
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify(fixtureIndex()), { status: 200 }),
    );
    const onDiagnostics = vi.fn();
    const loader = createRegistryIndexLoader({
      url: 'https://example.test/index.json',
      fetch: fetchFn as unknown as typeof fetch,
      ttlMs: 1000,
      now: () => clock,
      onDiagnostics,
    });
    await loader.load();
    await loader.load();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(onDiagnostics).toHaveBeenCalledTimes(1);
    clock = 1001;
    await loader.load();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('surfaces HTTP and JSON failures', async () => {
    const notFound = createRegistryIndexLoader({
      url: 'https://example.test/index.json',
      fetch: (async () => new Response('', { status: 404 })) as unknown as typeof fetch,
    });
    await expect(notFound.load()).rejects.toThrow(/HTTP 404/);
    const garbage = createRegistryIndexLoader({
      url: 'https://example.test/index.json',
      fetch: (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch,
    });
    await expect(garbage.load()).rejects.toThrow(/not valid JSON/);
  });
});
