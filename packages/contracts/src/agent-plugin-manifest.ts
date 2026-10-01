import type {
  AgentPluginOutputDirectory,
  ExecutableAgentPluginManifest,
  LegacyAgentPluginManifest,
} from './agent-plugin.js';

export const AGENT_PLUGIN_MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const MANIFEST_KEYS = ['schemaVersion', 'id', 'name', 'version', 'minHostVersion', 'protocol', 'protocolVersion',
  'minHostProtocolVersion', 'platforms', 'verifiedCliVersions', 'helpUrl', 'sourceRevision', 'artifact',
  'compatibleRevisions', 'unversionedBindingCompatible', 'outputDirectories'];
const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
const DIGEST = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
export function isAgentPluginId(value: unknown): value is string {
  return typeof value === 'string' && value !== 'pi' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
}
function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  } catch { return false; }
}
/** Literal filesystem-relative paths only; no URL decoding, backslashes or traversal aliases. */
export function isAgentPluginRelativePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 &&
    value.split('/').every((segment) => segment !== '.' && segment !== '..' && /^[a-zA-Z0-9._-]+$/.test(segment));
}
function parseOutputDirectory(value: unknown): AgentPluginOutputDirectory | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ['id', 'base', 'relativePath', 'kind']) ||
      typeof value.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value.id) ||
      (value.base !== 'working-directory' && value.base !== 'user-home') ||
      (value.kind !== 'image' && value.kind !== 'video') || typeof value.relativePath !== 'string') return undefined;
  const expanded = value.relativePath.replaceAll('{backendSessionId}', 'native-session').replaceAll('{encodedWorkingDirectory}', 'encoded-cwd');
  if (expanded.includes('{') || !isAgentPluginRelativePath(expanded)) return undefined;
  return { id: value.id, base: value.base, relativePath: value.relativePath, kind: value.kind };
}

/**
 * Bounded, duplicate-free output directory list.
 *
 * Shared by every backend declaration schema so a downloaded adapter manifest
 * and an extension-embedded session backend resolve media roots identically.
 */
export function parseOutputDirectories(
  value: unknown,
): readonly AgentPluginOutputDirectory[] | undefined {
  if (!Array.isArray(value) || value.length > 16) return undefined;
  const directories: AgentPluginOutputDirectory[] = [];
  for (const entry of value) {
    const directory = parseOutputDirectory(entry);
    if (!directory || directories.some((existing) => existing.id === directory.id)) return undefined;
    directories.push(directory);
  }
  return directories;
}

const LEGACY_KEYS = ['schemaVersion', 'id', 'name', 'version', 'minHostVersion', 'protocol', 'recipe', 'platforms', 'verifiedCliVersions', 'helpUrl'];

/** v1 is identifiable for an explicit migration offer. It has no artifact and cannot be launched. */
export function parseLegacyAgentPluginManifest(value: unknown): LegacyAgentPluginManifest | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, LEGACY_KEYS) || value.schemaVersion !== 1 ||
      value.id !== 'grok' || value.minHostVersion !== '0.0.0' || value.protocol !== 'acp' || value.recipe !== 'grok-stdio-v1' ||
      typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120 ||
      typeof value.version !== 'string' || !VERSION.test(value.version) || !isHttpsUrl(value.helpUrl) ||
      !Array.isArray(value.platforms) || value.platforms.length === 0 ||
      !value.platforms.every((platform) => platform === 'darwin' || platform === 'win32' || platform === 'linux') ||
      !Array.isArray(value.verifiedCliVersions) ||
      !value.verifiedCliVersions.every((version) => typeof version === 'string' && VERSION.test(version))) return undefined;
  return {
    schemaVersion: 1, id: 'grok', name: value.name, version: value.version, minHostVersion: '0.0.0',
    protocol: 'acp', recipe: 'grok-stdio-v1',
    platforms: value.platforms as LegacyAgentPluginManifest['platforms'],
    verifiedCliVersions: value.verifiedCliVersions as string[], helpUrl: value.helpUrl,
  };
}

/** Structural validation only: I/O digest/source/Host/platform checks belong to the installer. */
export function parseExecutableAgentPluginManifest(value: unknown): ExecutableAgentPluginManifest | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, MANIFEST_KEYS) || value.schemaVersion !== 2 ||
      !isAgentPluginId(value.id) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120 ||
      typeof value.version !== 'string' || !VERSION.test(value.version) ||
      typeof value.minHostVersion !== 'string' || !VERSION.test(value.minHostVersion) ||
      value.protocol !== 'piwin-agent-stdio' || value.protocolVersion !== 1 ||
      !Number.isSafeInteger(value.minHostProtocolVersion) || typeof value.minHostProtocolVersion !== 'number' || value.minHostProtocolVersion < 1 ||
      !isHttpsUrl(value.helpUrl) || typeof value.sourceRevision !== 'string' || !/^[a-f0-9]{40}$/.test(value.sourceRevision) ||
      !Array.isArray(value.platforms) || value.platforms.length === 0 || value.platforms.length > 3 ||
      !value.platforms.every((platform) => platform === 'darwin' || platform === 'win32' || platform === 'linux') ||
      new Set(value.platforms).size !== value.platforms.length ||
      !Array.isArray(value.verifiedCliVersions) || value.verifiedCliVersions.length > 100 ||
      !value.verifiedCliVersions.every((version) => typeof version === 'string' && VERSION.test(version)) ||
      !Array.isArray(value.compatibleRevisions) || value.compatibleRevisions.length > 100 ||
      !value.compatibleRevisions.every((revision) => typeof revision === 'string' && DIGEST.test(revision)) ||
      typeof value.unversionedBindingCompatible !== 'boolean' ||
      !isRecord(value.artifact) || !hasOnlyKeys(value.artifact, ['format', 'entrypoint', 'url', 'sha256', 'byteSize'])) return undefined;
  const artifact = value.artifact;
  if (artifact.format !== 'node-esm' || artifact.entrypoint !== 'agent.mjs' || !isHttpsUrl(artifact.url) ||
      typeof artifact.sha256 !== 'string' || !DIGEST.test(artifact.sha256) ||
      typeof artifact.byteSize !== 'number' || !Number.isSafeInteger(artifact.byteSize) ||
      artifact.byteSize < 1 || artifact.byteSize > AGENT_PLUGIN_MAX_ARTIFACT_BYTES) return undefined;
  const outputDirectories = parseOutputDirectories(value.outputDirectories);
  if (outputDirectories === undefined) return undefined;
  // Canonical field order binds the complete declaration; arrays keep their declared order.
  return {
    schemaVersion: 2, id: value.id, name: value.name, version: value.version, minHostVersion: value.minHostVersion,
    protocol: 'piwin-agent-stdio', protocolVersion: 1, minHostProtocolVersion: value.minHostProtocolVersion,
    platforms: value.platforms as ExecutableAgentPluginManifest['platforms'],
    verifiedCliVersions: value.verifiedCliVersions as string[], helpUrl: value.helpUrl,
    sourceRevision: value.sourceRevision,
    artifact: { format: 'node-esm', entrypoint: 'agent.mjs', url: artifact.url, sha256: artifact.sha256, byteSize: artifact.byteSize },
    compatibleRevisions: value.compatibleRevisions as string[], unversionedBindingCompatible: value.unversionedBindingCompatible,
    outputDirectories,
  };
}
