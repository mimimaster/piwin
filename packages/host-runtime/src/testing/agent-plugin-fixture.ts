/**
 * Installs the test-only backend adapter **as a piwin extension**.
 *
 * Integration tests must not inject a transport: the Host launches whatever
 * artifact the enabled extension revision declares, so the fixture is a real
 * `agent.mjs` that speaks the frame protocol (see
 * `fixtures/agent-plugin-fixture.mjs`) plus a `piwin.json` `sessionBackend`
 * declaration. Nothing here uses the retired per-agent inventory.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createExtensionRevisionStore, installExtension } from '@piwin/extensions';

export const FIXTURE_AGENT_ID = 'fixture';
export const FIXTURE_VERSION = '1.0.0';

/** Relative artifact path inside the extension revision. */
export const FIXTURE_ARTIFACT_ENTRYPOINT = 'dist/agent.mjs';

/** Absolute path to the fixture adapter source tests hash and install. */
export const FIXTURE_ADAPTER_PATH = fileURLToPath(new URL('../../fixtures/agent-plugin-fixture.mjs', import.meta.url));
const FIXTURE_ADAPTER = FIXTURE_ADAPTER_PATH;

export type FixtureManifestOverrides = Record<string, unknown> & { agentId?: string };

function urls(agentId: string, version: string) {
  const base = `https://extension.piwinwin.com/agents/${agentId}-${version}`;
  return { manifest: `${base}.json`, artifact: `${base}/agent.mjs` };
}

/** Default declaration: images land under `<cwd>/.piwin-fixture/images`. */
export const FIXTURE_OUTPUT_DIRECTORIES = [
  { id: 'images', base: 'working-directory', relativePath: '.piwin-fixture/images', kind: 'image' },
  { id: 'videos', base: 'working-directory', relativePath: '.piwin-fixture/videos', kind: 'video' },
];

/**
 * Shape of the retired downloaded-adapter manifest.
 *
 * Only the retired inventory's own unit test still needs this.
 */
export function buildFixtureManifest(overrides: FixtureManifestOverrides, digest: string, byteSize: number, agentId: string): Record<string, unknown> {
  const version = FIXTURE_VERSION;
  return {
    schemaVersion: 2,
    id: agentId,
    name: 'Fixture Agent',
    version,
    minHostVersion: '0.0.0',
    protocol: 'piwin-agent-stdio',
    protocolVersion: 1,
    minHostProtocolVersion: 1,
    platforms: ['darwin', 'win32', 'linux'],
    verifiedCliVersions: ['1.0.0'],
    helpUrl: 'https://piwinwin.com',
    sourceRevision: 'a'.repeat(40),
    artifact: { format: 'node-esm', entrypoint: 'agent.mjs', url: urls(agentId, version).artifact, sha256: digest, byteSize },
    compatibleRevisions: [],
    unversionedBindingCompatible: false,
    outputDirectories: FIXTURE_OUTPUT_DIRECTORIES,
    ...overrides,
    ...(overrides.agentId !== undefined ? { id: overrides.agentId } : {}),
  };
}

/**
 * The extension-side declaration: same protocol, but the artifact ships inside
 * the revision, so it names a relative entrypoint instead of a download URL.
 */
export function buildFixtureDeclaration(
  overrides: FixtureManifestOverrides,
  digest: string,
  byteSize: number,
  agentId: string,
): Record<string, unknown> {
  const { agentId: overrideAgentId, ...rest } = overrides;
  return {
    schemaVersion: 1,
    id: agentId,
    name: 'Fixture Agent',
    version: FIXTURE_VERSION,
    minHostVersion: '0.0.0',
    protocol: 'piwin-agent-stdio',
    protocolVersion: 1,
    minHostProtocolVersion: 1,
    platforms: ['darwin', 'win32', 'linux'],
    verifiedCliVersions: ['1.0.0'],
    helpUrl: 'https://piwinwin.com',
    artifact: {
      format: 'node-esm',
      entrypoint: FIXTURE_ARTIFACT_ENTRYPOINT,
      sha256: digest,
      byteSize,
    },
    compatibleRevisions: [],
    unversionedBindingCompatible: false,
    outputDirectories: FIXTURE_OUTPUT_DIRECTORIES,
    ...rest,
    ...(overrideAgentId !== undefined ? { id: overrideAgentId } : {}),
  };
}

/**
 * Stage and enable a backend extension for the fixture adapter. Returns the env
 * the Host must pass to the adapter process.
 */
export async function installFixtureAgentAdapter(
  rootDir: string,
  options: { script?: unknown; overrides?: FixtureManifestOverrides; agentId?: string } = {},
): Promise<{ agentId: string; extensionId: string; revision: string; env: NodeJS.ProcessEnv }> {
  const agentId = options.agentId ?? FIXTURE_AGENT_ID;
  const bytes = await readFile(FIXTURE_ADAPTER);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const declaration = buildFixtureDeclaration(options.overrides ?? {}, digest, bytes.byteLength, agentId);

  const sourceDirectory = join(rootDir, 'fixture-extension-source');
  await mkdir(join(sourceDirectory, 'dist'), { recursive: true });
  await writeFile(join(sourceDirectory, 'dist', 'agent.mjs'), bytes);
  await writeFile(
    join(sourceDirectory, 'piwin.json'),
    `${JSON.stringify({ sessionBackend: declaration }, null, 2)}\n`,
  );
  await writeFile(
    join(sourceDirectory, 'package.json'),
    `${JSON.stringify({ name: agentId, version: FIXTURE_VERSION, private: true }, null, 2)}\n`,
  );

  const installed = await installExtension({
    piwinRoot: rootDir,
    source: { kind: 'local', path: sourceDirectory },
    name: agentId,
  });
  // Installing stages an inactive revision; a backend must be enabled to serve.
  await createExtensionRevisionStore(rootDir).setEnabled(installed.extensionId, true);

  const scriptPath = join(rootDir, 'fixture-script.json');
  await writeFile(scriptPath, JSON.stringify(options.script ?? {}));
  return {
    agentId,
    extensionId: installed.extensionId,
    revision: installed.contentRevision,
    env: { ...process.env, PIWIN_FIXTURE_SCRIPT: scriptPath, PIWIN_FIXTURE_AGENT_ID: agentId },
  };
}
