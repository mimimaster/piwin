import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { resolveBundledAssetsRoot } from './bundled-assets-root.js';
import {
  AgentPluginStore,
  DEFAULT_REVIEWED_AGENT_IDS,
  agentManifestRevision,
  parseAgentPluginManifest,
  parseAgentPluginSource,
} from '@piwin/agent-plugins';
import {
  isAgentPluginId,
  type AgentPluginInstallation,
  type AgentPluginSource,
  type ExecutableAgentPluginManifest,
  type HostCommand,
  type HostResponse,
} from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { withFileWriteLock, writeTextFileAtomic } from '@piwin/session';
import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import { getPiwinRoot } from './paths.js';
import { fail, ok } from './response-helpers.js';

const REVIEWED_HOSTS = new Set(['raw.githubusercontent.com', 'extension.piwinwin.com']);
const HOST_PROTOCOL_VERSION = 1;
const HOST_VERSION = '0.0.0';
const MANIFEST_MAX_BYTES = 64 * 1024;

/**
 * Reviewed ids a mock Host may additionally accept. Production never calls
 * this; it exists so a test-only fixture adapter can prove the Host needs no
 * source change to serve a second agent id.
 */
const fixtureAgentIds: string[] = [];

export function allowFixtureAgentId(agentId: string): void {
  if (!isAgentPluginId(agentId)) throw new Error('agent-fixture-id-invalid');
  if (!fixtureAgentIds.includes(agentId)) fixtureAgentIds.push(agentId);
}

function reviewedAgentIds(): readonly string[] {
  return [...DEFAULT_REVIEWED_AGENT_IDS, ...fixtureAgentIds];
}

export function createAgentPluginInventory(rootDir: string): AgentPluginStore {
  const filePath = join(rootDir, 'agents', 'inventory.json');
  const read = async (): Promise<unknown> => {
    try {
      return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    }
  };
  return new AgentPluginStore({
    read,
    mutate: (operation) => withFileWriteLock(filePath, async () => {
      const changed = operation(await read());
      await mkdir(dirname(filePath), { recursive: true });
      await writeTextFileAtomic(filePath, `${JSON.stringify(changed.document, null, 2)}\n`);
      return changed.result;
    }),
  }, reviewedAgentIds());
}

export async function requireEnabledAgentPlugin(rootDir: string): Promise<AgentPluginInstallation> {
  return await requireEnabledAgentPluginFor(rootDir, 'grok');
}

/** Same gate for any adapter id; the Host never hardcodes which agents exist. */
export async function requireEnabledAgentPluginFor(
  rootDir: string,
  agentId: string,
): Promise<AgentPluginInstallation> {
  const installed = await createAgentPluginInventory(rootDir).get(agentId);
  if (installed === undefined) throw new Error(`agent-plugin-not-installed: install the ${agentId} adapter in the marketplace`);
  if (!installed.enabled) throw new Error('agent-plugin-disabled: enable the adapter before starting another Run');
  return installed;
}

/**
 * Everything the backend needs to launch an adapter: the verified entrypoint,
 * its revision, the user-owned CLI path and the declared output directories.
 */
export async function requireAgentPluginLaunch(rootDir: string, agentId: string): Promise<{
  agentId: string;
  entrypoint: string;
  revision: string;
  runtime: { binaryPath?: string };
  outputDirectories: import('@piwin/contracts').AgentPluginOutputDirectory[];
}> {
  const installed = await requireEnabledAgentPluginFor(rootDir, agentId);
  if (installed.manifest.schemaVersion !== 2) throw new Error('agent-manifest-not-executable');
  await verifyInstalledAgentArtifact(rootDir, installed);
  return {
    agentId,
    entrypoint: installedArtifactPath(rootDir, agentId, installed.revision),
    revision: installed.revision,
    runtime: installed.runtime,
    outputDirectories: [...installed.manifest.outputDirectories],
  };
}

/** Installed adapter ids, enabled or not. Used to validate a requested agent id. */
export async function listInstalledAgentIds(rootDir: string): Promise<string[]> {
  const plugins = await createAgentPluginInventory(rootDir).list();
  return plugins.map((plugin) => plugin.agentId);
}

/** Read and hash the installed file. This never spawns the adapter or the user CLI. */
export async function verifyInstalledAgentArtifact(rootDir: string, installation: AgentPluginInstallation): Promise<void> {
  if (installation.manifest.schemaVersion !== 2) throw new Error('agent-manifest-not-executable');
  const filePath = installedArtifactPath(rootDir, installation.agentId, installation.revision);
  const realRoot = await realpath(rootDir);
  const realFile = await realpath(filePath);
  if (!realFile.startsWith(realRoot + sep)) throw new Error('agent-install-path-invalid');
  const handle = await open(realFile, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const details = await handle.stat();
    if (!details.isFile() || details.size !== installation.manifest.artifact.byteSize) throw new Error('agent-artifact-integrity');
    const bytes = Buffer.alloc(details.size);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const digest = createHash('sha256').update(bytes.subarray(0, bytesRead)).digest('hex');
    if (digest !== installation.manifest.artifact.sha256) throw new Error('agent-artifact-integrity');
  } finally {
    await handle.close();
  }
}

export type InstallAgentPluginOptions = {
  /** Required to replace an installed revision. Session bindings are not rewritten. */
  confirmMigration?: boolean;
};

export async function installAgentPlugin(
  rootDir: string,
  input: AgentPluginSource,
  platform: string = process.platform,
  fetchImpl: typeof fetch = fetch,
  options: InstallAgentPluginOptions = {},
): Promise<AgentPluginInstallation> {
  const source = parseAgentPluginSource(input);
  const inventory = createAgentPluginInventory(rootDir);
  if (source.kind === 'bundled') {
    return await installBundledAgentPlugin(rootDir, inventory, source, platform, options);
  }
  const manifestBytes = await downloadBounded(source.url, MANIFEST_MAX_BYTES, fetchImpl);
  if (createHash('sha256').update(manifestBytes).digest('hex') !== source.sha256) throw new Error('agent-manifest-digest-mismatch');
  const manifest = parseAgentPluginManifest(JSON.parse(manifestBytes.toString('utf8')) as unknown);
  if (manifest.id !== source.agentId || manifest.version !== source.version) throw new Error('agent-manifest-version-mismatch');
  if (manifest.schemaVersion !== 2) throw new Error('agent-manifest-not-executable');
  assertInstallable(manifest, platform);
  const revision = agentManifestRevision(manifest);
  const existing = await inventory.get(manifest.id);
  if (existing !== undefined && existing.revision === revision) {
    await verifyInstalledAgentArtifact(rootDir, existing);
    return existing;
  }
  if (existing !== undefined && options.confirmMigration !== true) {
    throw new Error('agent-update-requires-migration: installed revision must not be replaced silently');
  }
  const directory = installedDirectory(rootDir, manifest.id, revision);
  try {
    await writeArtifact(rootDir, directory, manifest, fetchImpl);
    await verifyInstalledAgentArtifact(rootDir, {
      agentId: manifest.id, manifest, revision, enabled: true, source,
      installedAt: new Date().toISOString(), runtime: { ownership: 'user' },
    });
    return await inventory.install({ source, manifest, platform, ...(options.confirmMigration === true ? { confirmMigration: true } : {}) });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function removeInstalledAgentFiles(rootDir: string, agentId: string): Promise<void> {
  if (!isAgentPluginId(agentId)) throw new Error('agent-install-path-invalid');
  await rm(resolve(rootDir, 'agents', agentId), { recursive: true, force: true });
}

export async function handleAgentPluginCommand(deps: HostRuntimeKernel, command: HostCommand, requestId: string | undefined): Promise<HostResponse | null> {
  if (!['agents/list', 'agents/install', 'agents/set-enabled', 'agents/uninstall', 'agents/select-runtime'].includes(command.type)) return null;
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const inventory = createAgentPluginInventory(rootDir);
  try {
    switch (command.type) {
      case 'agents/list':
        return ok(requestId, command.type, { plugins: await inventory.list() });
      case 'agents/install': {
        const mockPlatform = deps.options.mock === true && deps.options.externalAgents ? deps.options.externalAgents.testPlatform : undefined;
        const plugin = await installAgentPlugin(
          rootDir,
          command.source,
          mockPlatform ?? process.platform,
          fetch,
          command.confirmMigration === true ? { confirmMigration: true } : {},
        );
        return ok(requestId, command.type, { plugin, dependencyInstallation: 'manual', loginGuidance: 'Authenticate the agent CLI on the Host, then check again.' });
      }
      case 'agents/set-enabled': {
        const plugin = await inventory.setEnabled(command.agentId, command.enabled);
        deps.externalAgents?.invalidateStatus();
        return ok(requestId, command.type, { plugin });
      }
      case 'agents/uninstall':
        await inventory.uninstall(command.agentId);
        await removeInstalledAgentFiles(rootDir, command.agentId);
        deps.externalAgents?.invalidateStatus();
        return ok(requestId, command.type, { agentId: command.agentId, removed: true, historyPreserved: true, runtimePreserved: true });
      case 'agents/select-runtime': {
        const plugin = await inventory.selectRuntime(command.agentId, command.binaryPath);
        deps.externalAgents?.invalidateStatus();
        return ok(requestId, command.type, { plugin });
      }
      default: return null;
    }
  } catch (error) {
    return fail(requestId, command.type, formatError(error));
  }
}

function assertInstallable(manifest: ExecutableAgentPluginManifest, platform: string): void {
  if (!manifest.platforms.includes(platform as 'darwin' | 'linux' | 'win32')) {
    throw new Error('agent-platform-unverified: this Host platform is not in the reviewed manifest');
  }
  if (manifest.minHostProtocolVersion > HOST_PROTOCOL_VERSION) throw new Error('agent-host-protocol-incompatible');
  if (!versionAtMost(manifest.minHostVersion, HOST_VERSION)) throw new Error('agent-host-version-incompatible');
  assertReviewedUrl(manifest.artifact.url);
}

function versionAtMost(minimum: string, current: string): boolean {
  const required = minimum.split('.').map(Number);
  const actual = current.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const left = required[index] ?? 0;
    const right = actual[index] ?? 0;
    if (left !== right) return left < right;
  }
  return true;
}

/**
 * Install the adapter artifact shipped with the Host. Same digest gate as a
 * download: the bundled bytes must match the manifest the Host read from disk.
 */
async function installBundledAgentPlugin(
  rootDir: string,
  inventory: AgentPluginStore,
  source: Extract<AgentPluginSource, { kind: 'bundled' }>,
  platform: string,
  options: InstallAgentPluginOptions,
): Promise<AgentPluginInstallation> {
  const bundledRoot = resolveBundledAgentDirectory(source.agentId);
  const manifestBytes = await readFile(join(bundledRoot, 'manifest.json'), 'utf8');
  const manifest = parseAgentPluginManifest(JSON.parse(manifestBytes) as unknown);
  if (manifest.schemaVersion !== 2) throw new Error('agent-manifest-not-executable');
  if (manifest.id !== source.agentId) throw new Error('agent-manifest-version-mismatch');
  assertInstallable(manifest, platform);
  const revision = agentManifestRevision(manifest);
  const existing = await inventory.get(manifest.id);
  if (existing !== undefined && existing.revision === revision) {
    await verifyInstalledAgentArtifact(rootDir, existing);
    return existing;
  }
  if (existing !== undefined && options.confirmMigration !== true) {
    throw new Error('agent-update-requires-migration: installed revision must not be replaced silently');
  }
  const directory = installedDirectory(rootDir, manifest.id, revision);
  try {
    await writeArtifactBytes(rootDir, directory, manifest, await readFile(join(bundledRoot, manifest.artifact.entrypoint)));
    await verifyInstalledAgentArtifact(rootDir, {
      agentId: manifest.id, manifest, revision, enabled: true, source,
      installedAt: new Date().toISOString(), runtime: { ownership: 'user' },
    });
    return await inventory.install({ source, manifest, platform, ...(options.confirmMigration === true ? { confirmMigration: true } : {}) });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

/** Adapter artifacts shipped with the Host, resolved like every other bundled asset. */
export function resolveBundledAgentDirectory(agentId: string): string {
  if (!isAgentPluginId(agentId)) throw new Error('agent-install-path-invalid');
  return resolveBundledAssetsRoot({
    layoutPath: join('agents', agentId),
    moduleUrl: import.meta.url,
    // Grok is not a bundled asset. Packaged Hosts set PIWIN_BUNDLED_ASSETS_ROOT;
    // without it this path simply does not exist and install fails closed.
    relativeFallback: join('bundled', 'agents', agentId),
  });
}

function writeArtifact(rootDir: string, directory: string, manifest: ExecutableAgentPluginManifest, fetchImpl: typeof fetch): Promise<void> {
  return downloadBounded(manifest.artifact.url, manifest.artifact.byteSize, fetchImpl).then(
    (bytes) => writeArtifactBytes(rootDir, directory, manifest, bytes),
  );
}

async function writeArtifactBytes(rootDir: string, directory: string, manifest: ExecutableAgentPluginManifest, bytes: Buffer): Promise<void> {
  if (bytes.byteLength !== manifest.artifact.byteSize || createHash('sha256').update(bytes).digest('hex') !== manifest.artifact.sha256) {
    throw new Error('agent-artifact-digest-mismatch');
  }
  await mkdir(directory, { recursive: true });
  const realRoot = await realpath(rootDir);
  const realDirectory = await realpath(directory);
  if (!realDirectory.startsWith(realRoot + sep)) throw new Error('agent-install-path-invalid');
  const temporary = join(realDirectory, `.agent.mjs.${process.pid}.tmp`);
  await writeFile(temporary, bytes);
  await rename(temporary, join(realDirectory, manifest.artifact.entrypoint));
  await writeTextFileAtomic(join(realDirectory, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
}

async function downloadBounded(url: string, maxBytes: number, fetchImpl: typeof fetch): Promise<Buffer> {
  assertReviewedUrl(url);
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
  if (!response.ok) throw new Error(`agent-download-failed: HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error('agent-download-empty');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) throw new Error('agent-download-too-large');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks);
}

function assertReviewedUrl(value: string): void {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || !REVIEWED_HOSTS.has(url.hostname)) {
    throw new Error('agent-manifest-source-unreviewed');
  }
}

function installedDirectory(rootDir: string, agentId: string, revision: string): string {
  if (!isAgentPluginId(agentId) || !/^[a-f0-9]{64}$/.test(revision)) throw new Error('agent-install-path-invalid');
  const directory = resolve(rootDir, 'agents', agentId, revision);
  const root = resolve(rootDir);
  if (!directory.startsWith(root + sep)) throw new Error('agent-install-path-invalid');
  return directory;
}

function installedArtifactPath(rootDir: string, agentId: string, revision: string): string {
  return join(installedDirectory(rootDir, agentId, revision), 'agent.mjs');
}
