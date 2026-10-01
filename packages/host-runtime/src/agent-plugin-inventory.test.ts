import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GROK_PLUGIN_MANIFEST, agentManifestRevision, parseAgentPluginManifest } from '@piwin/agent-plugins';
import { installAgentPlugin, verifyInstalledAgentArtifact } from './agent-plugin-inventory.js';
import { FIXTURE_ADAPTER_PATH, FIXTURE_AGENT_ID, buildFixtureManifest } from './testing/agent-plugin-fixture.js';
import { createAgentPluginInventory } from './agent-plugin-inventory.js';

const ARTIFACT_BYTES = Buffer.from('export const adapter = "grok";\n', 'utf8');
const ARTIFACT_DIGEST = createHash('sha256').update(ARTIFACT_BYTES).digest('hex');
const MANIFEST_URL = 'https://extension.piwinwin.com/agents/grok-2.0.0.json';
const ARTIFACT_URL = 'https://extension.piwinwin.com/agents/grok-2.0.0/agent.mjs';

function v2Manifest(overrides: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: 2, id: 'grok', name: 'Grok Build', version: '2.0.0', minHostVersion: '0.0.0',
    protocol: 'piwin-agent-stdio', protocolVersion: 1, minHostProtocolVersion: 1,
    platforms: ['darwin'], verifiedCliVersions: ['1.0.44'], helpUrl: 'https://grok.com',
    sourceRevision: 'a'.repeat(40),
    artifact: {
      format: 'node-esm', entrypoint: 'agent.mjs', url: ARTIFACT_URL,
      sha256: ARTIFACT_DIGEST, byteSize: ARTIFACT_BYTES.byteLength,
    },
    compatibleRevisions: [], unversionedBindingCompatible: false,
    outputDirectories: [{
      id: 'images', base: 'user-home',
      relativePath: '.grok/sessions/{encodedWorkingDirectory}/{backendSessionId}/images', kind: 'image',
    }],
    ...overrides,
  };
}

function registrySource(manifest: unknown, version = '2.0.0') {
  const body = Buffer.from(JSON.stringify(manifest), 'utf8');
  return {
    kind: 'registry' as const, agentId: 'grok', version, url: MANIFEST_URL,
    sha256: createHash('sha256').update(body).digest('hex'),
  };
}

/** Serves the manifest and artifact; counts each so idempotent installs are observable. */
function fetchFixture(manifest: unknown, artifact: Buffer = ARTIFACT_BYTES) {
  const calls = { manifest: 0, artifact: 0 };
  const fetchImpl = vi.fn<typeof fetch>(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === MANIFEST_URL) {
      calls.manifest += 1;
      return new Response(JSON.stringify(manifest));
    }
    if (url === ARTIFACT_URL) {
      calls.artifact += 1;
      return new Response(artifact.slice());
    }
    return new Response('', { status: 404 });
  });
  return { fetchImpl, calls };
}

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'piwin-agent-artifact-'));
  roots.push(root);
  return root;
}

describe('bundled adapter artifact', () => {
  it('installs the shipped artifact only after its digest matches the manifest', async () => {
    const root = await tempRoot();
    const assetsRoot = await mkdtemp(join(tmpdir(), 'piwin-bundled-agents-'));
    roots.push(assetsRoot);
    const bytes = await readFile(FIXTURE_ADAPTER_PATH);
    const manifest = buildFixtureManifest(
      {},
      createHash('sha256').update(bytes).digest('hex'),
      bytes.byteLength,
      'grok',
    );
    const directory = join(assetsRoot, 'agents', 'grok');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'agent.mjs'), bytes);
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    vi.stubEnv('PIWIN_BUNDLED_ASSETS_ROOT', assetsRoot);
    try {
      const installed = await installAgentPlugin(root, { kind: 'bundled', agentId: 'grok' }, process.platform);
      expect(installed).toMatchObject({ agentId: 'grok', enabled: true });
      await expect(verifyInstalledAgentArtifact(root, installed)).resolves.toBeUndefined();
      // A tampered bundled artifact is refused and leaves no usable state.
      const tamperedRoot = await tempRoot();
      await writeFile(join(directory, 'agent.mjs'), Buffer.from('tampered'));
      await expect(installAgentPlugin(tamperedRoot, { kind: 'bundled', agentId: 'grok' }, process.platform))
        .rejects.toThrow('agent-artifact-digest-mismatch');
      expect(await createAgentPluginInventory(tamperedRoot).list()).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('Agent plugin artifact installer', () => {
  it('downloads, verifies and installs a reviewed artifact before recording the install', async () => {
    const root = await tempRoot();
    const manifest = v2Manifest();
    const { fetchImpl, calls } = fetchFixture(manifest);
    const installed = await installAgentPlugin(root, registrySource(manifest), 'darwin', fetchImpl);
    const parsed = parseAgentPluginManifest(manifest);
    const revision = agentManifestRevision(parsed);
    expect(installed).toMatchObject({ agentId: 'grok', revision });
    expect(calls).toEqual({ manifest: 1, artifact: 1 });
    const directory = join(root, 'agents', 'grok', revision);
    expect(await readFile(join(directory, 'agent.mjs'))).toEqual(ARTIFACT_BYTES);
    expect(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))).toEqual(parsed);
    expect((await createAgentPluginInventory(root).get('grok'))?.revision).toBe(revision);
    await expect(verifyInstalledAgentArtifact(root, installed)).resolves.toBeUndefined();
  });

  it('re-downloads nothing when the same revision is already installed and verified', async () => {
    const root = await tempRoot();
    const manifest = v2Manifest();
    const { fetchImpl, calls } = fetchFixture(manifest);
    const source = registrySource(manifest);
    const first = await installAgentPlugin(root, source, 'darwin', fetchImpl);
    const second = await installAgentPlugin(root, source, 'darwin', fetchImpl);
    expect(second).toEqual(first);
    expect(calls.artifact).toBe(1);
  });

  it('rejects tampered bytes on activation without spawning anything', async () => {
    const root = await tempRoot();
    const manifest = v2Manifest();
    const { fetchImpl } = fetchFixture(manifest);
    const installed = await installAgentPlugin(root, registrySource(manifest), 'darwin', fetchImpl);
    await writeFile(join(root, 'agents', 'grok', installed.revision, 'agent.mjs'), 'export const adapter = "evil";\n');
    await expect(verifyInstalledAgentArtifact(root, installed)).rejects.toThrow('agent-artifact-integrity');
  });

  it('rejects a wrong artifact digest and leaves no directory or inventory record', async () => {
    const root = await tempRoot();
    const manifest = v2Manifest({ artifact: { format: 'node-esm', entrypoint: 'agent.mjs', url: ARTIFACT_URL, sha256: 'b'.repeat(64), byteSize: ARTIFACT_BYTES.byteLength } });
    const { fetchImpl } = fetchFixture(manifest);
    await expect(installAgentPlugin(root, registrySource(manifest), 'darwin', fetchImpl)).rejects.toThrow('agent-artifact-digest-mismatch');
    await expect(stat(join(root, 'agents', 'grok'))).rejects.toThrow();
    expect(await createAgentPluginInventory(root).list()).toEqual([]);
  });

  it('fails closed for unreviewed artifact hosts and incompatible Host contracts', async () => {
    const root = await tempRoot();
    const unreviewed = v2Manifest({ artifact: { format: 'node-esm', entrypoint: 'agent.mjs', url: 'https://example.com/agent.mjs', sha256: ARTIFACT_DIGEST, byteSize: ARTIFACT_BYTES.byteLength } });
    const unreviewedFetch = fetchFixture(unreviewed);
    await expect(installAgentPlugin(root, registrySource(unreviewed), 'darwin', unreviewedFetch.fetchImpl)).rejects.toThrow('source-unreviewed');
    const futureProtocol = v2Manifest({ minHostProtocolVersion: 2 });
    await expect(installAgentPlugin(root, registrySource(futureProtocol), 'darwin', fetchFixture(futureProtocol).fetchImpl)).rejects.toThrow('protocol-incompatible');
    const futureHost = v2Manifest({ minHostVersion: '1.0.0' });
    await expect(installAgentPlugin(root, registrySource(futureHost), 'darwin', fetchFixture(futureHost).fetchImpl)).rejects.toThrow('host-version-incompatible');
    const otherPlatform = v2Manifest({ platforms: ['linux'] });
    await expect(installAgentPlugin(root, registrySource(otherPlatform), 'darwin', fetchFixture(otherPlatform).fetchImpl)).rejects.toThrow('platform-unverified');
    expect(await createAgentPluginInventory(root).list()).toEqual([]);
  });

  it('refuses a registry source that pins a non-executable schema 1 declaration', async () => {
    const root = await tempRoot();
    const { fetchImpl } = fetchFixture(GROK_PLUGIN_MANIFEST);
    const source = registrySource(GROK_PLUGIN_MANIFEST, '1.0.0');
    await expect(installAgentPlugin(root, source, 'darwin', fetchImpl)).rejects.toThrow('agent-manifest-not-executable');
    expect(await createAgentPluginInventory(root).list()).toEqual([]);
  });

  it('verifies the pinned manifest digest and version before touching the disk', async () => {
    const root = await tempRoot();
    const manifest = v2Manifest();
    const { fetchImpl } = fetchFixture(manifest);
    await expect(installAgentPlugin(root, { ...registrySource(manifest), sha256: 'c'.repeat(64) }, 'darwin', fetchImpl)).rejects.toThrow('manifest-digest-mismatch');
    await expect(installAgentPlugin(root, registrySource(manifest, '9.9.9'), 'darwin', fetchImpl)).rejects.toThrow('version-mismatch');
    expect(await createAgentPluginInventory(root).list()).toEqual([]);
  });

  it('never replaces an installed revision silently', async () => {
    const root = await tempRoot();
    const first = v2Manifest();
    await installAgentPlugin(root, registrySource(first), 'darwin', fetchFixture(first).fetchImpl);
    const next = v2Manifest({ version: '2.0.1' });
    await expect(installAgentPlugin(root, registrySource(next, '2.0.1'), 'darwin', fetchFixture(next).fetchImpl)).rejects.toThrow('requires-migration');
  });

  it('installs a bundled executable artifact without downloading anything', async () => {
    const root = await tempRoot();
    const assetsRoot = await mkdtemp(join(tmpdir(), 'piwin-bundled-dev-'));
    roots.push(assetsRoot);
    const directory = join(assetsRoot, 'agents', 'grok');
    await mkdir(directory, { recursive: true });
    const bytes = await readFile(FIXTURE_ADAPTER_PATH);
    await writeFile(join(directory, 'agent.mjs'), bytes);
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(
      buildFixtureManifest({}, createHash('sha256').update(bytes).digest('hex'), bytes.byteLength, 'grok'),
    ));
    vi.stubEnv('PIWIN_BUNDLED_ASSETS_ROOT', assetsRoot);
    try {
      const fetchImpl = vi.fn<typeof fetch>();
      const installed = await installAgentPlugin(root, { kind: 'bundled', agentId: 'grok' }, 'darwin', fetchImpl);
      expect(installed).toMatchObject({ agentId: 'grok', manifest: { schemaVersion: 2 } });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('refuses a bundled install when no artifact is shipped, leaving no state', async () => {
    const root = await tempRoot();
    const emptyAssets = await mkdtemp(join(tmpdir(), 'piwin-bundled-empty-'));
    roots.push(emptyAssets);
    vi.stubEnv('PIWIN_BUNDLED_ASSETS_ROOT', emptyAssets);
    try {
      await expect(installAgentPlugin(root, { kind: 'bundled', agentId: 'grok' }, 'darwin')).rejects.toThrow();
      expect(await createAgentPluginInventory(root).list()).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
