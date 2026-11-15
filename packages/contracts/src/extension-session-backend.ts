/**
 * Versioned `sessionBackend` declaration in an extension's `piwin.json`.
 *
 * A backend-type extension contributes a complete session backend instead of
 * Pi tools, hooks or providers. Its adapter ships inside the same immutable
 * extension revision, so this declaration names a safe relative entrypoint and
 * pins the exact bytes instead of a download URL.
 *
 * Protocol frames, capabilities, media proposals and prompt outcomes are the
 * existing agent-plugin contracts; only the artifact location differs from a
 * downloaded adapter manifest. The Host reads this declaration as data:
 * staging, listing and validation never import or execute the artifact.
 */
import type { AgentPluginOutputDirectory } from './agent-plugin.js';
import { AGENT_PLUGIN_PROTOCOL_VERSION } from './agent-plugin-protocol.js';
import {
  AGENT_PLUGIN_MAX_ARTIFACT_BYTES,
  isAgentPluginId,
  isAgentPluginRelativePath,
  parseOutputDirectories,
} from './agent-plugin-manifest.js';

export const EXTENSION_SESSION_BACKEND_SCHEMA_VERSION = 1;

/** `pi` is the built-in Pi backend; an extension may never claim it. */
export const RESERVED_EXTENSION_BACKEND_IDS = ['pi'] as const;

const DECLARATION_KEYS = ['schemaVersion', 'id', 'name', 'description', 'icon', 'version', 'minHostVersion', 'protocol', 'protocolVersion',
  'minHostProtocolVersion', 'platforms', 'verifiedCliVersions', 'helpUrl', 'artifact', 'compatibleRevisions',
  'unversionedBindingCompatible', 'outputDirectories'];
const ARTIFACT_KEYS = ['format', 'entrypoint', 'sha256', 'byteSize'];
const BRAND_ICON_KEYS = ['kind', 'id'];
const GLYPH_ICON_KEYS = ['kind', 'viewBox', 'paths', 'fillRule'];
const NAME_MAX_LENGTH = 120;
const ICON_BRAND_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SVG_PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9.,+\-\s]+$/;
const ICON_MAX_PATHS = 8;
const ICON_MAX_TOTAL_PATH_LENGTH = 4096;
const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const PLATFORMS = ['darwin', 'win32', 'linux'] as const;

/**
 * Vendor mark declared by a session-backend extension (`piwin.json` -> `sessionBackend.icon`).
 *
 * - `brand`: reuses a built-in `@piwin/ui-kit` `ProviderIcon` brand slug (e.g. `claude`, `codex`, `xai`, `antigravity`).
 * - `glyph`: safe structured monochrome SVG path data rendered with `fill="currentColor"` (never raw HTML).
 */
export type ExtensionSessionBackendIcon =
  | { kind: 'brand'; id: string }
  | {
      kind: 'glyph';
      viewBox: string;
      paths: readonly string[];
      fillRule?: 'nonzero' | 'evenodd';
    };

/** Self-contained adapter that ships inside the extension revision. */
export type ExtensionSessionBackendArtifact = {
  format: 'node-esm';
  /** Safe path relative to the extension package root, e.g. `dist/agent.mjs`. */
  entrypoint: string;
  /** Digest and size of the staged file the Host will spawn. */
  sha256: string;
  byteSize: number;
};

export type ExtensionSessionBackendDeclaration = {
  schemaVersion: typeof EXTENSION_SESSION_BACKEND_SCHEMA_VERSION;
  /** Backend identity; persisted verbatim in `SessionBackendBinding.agentId`. */
  id: string;
  name: string;
  description?: string;
  icon?: ExtensionSessionBackendIcon;
  version: string;
  minHostVersion: string;
  protocol: 'piwin-agent-stdio';
  protocolVersion: typeof AGENT_PLUGIN_PROTOCOL_VERSION;
  minHostProtocolVersion: number;
  platforms: readonly ('darwin' | 'win32' | 'linux')[];
  verifiedCliVersions: readonly string[];
  helpUrl: string;
  artifact: ExtensionSessionBackendArtifact;
  /** Compatibility is permission to offer migration, not permission to migrate silently. */
  compatibleRevisions: readonly string[];
  unversionedBindingCompatible: boolean;
  /** The Host derives media roots from this declaration, never from a process message. */
  outputDirectories: readonly AgentPluginOutputDirectory[];
};

/**
 * Field-to-code mapping:
 *
 * - `name`, `helpUrl` -> `invalid-name`
 * - `version`, `minHostVersion`, `verifiedCliVersions`, `compatibleRevisions` -> `invalid-version`
 * - `minHostProtocolVersion` -> `unsupported-protocol-version`
 * - `format`, `sha256`, `byteSize` shape, `unversionedBindingCompatible` -> `invalid-artifact`
 * - `schemaVersion`, `protocol`, `platforms`, `outputDirectories` keep their own codes.
 */
export type ExtensionSessionBackendFailureCode =
  | 'not-an-object'
  | 'unknown-key'
  | 'unsupported-schema'
  | 'invalid-backend-id'
  | 'reserved-backend-id'
  | 'invalid-name'
  | 'invalid-icon'
  | 'invalid-version'
  | 'unsupported-protocol'
  | 'unsupported-protocol-version'
  | 'unsupported-platform'
  | 'invalid-artifact'
  | 'invalid-artifact-entrypoint'
  | 'artifact-too-large'
  | 'invalid-output-directory';

export type ExtensionSessionBackendParseResult =
  | { ok: true; declaration: ExtensionSessionBackendDeclaration }
  | { ok: false; code: ExtensionSessionBackendFailureCode; detail: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Unknown keys are rejected rather than ignored: a typo in a reviewed
 * declaration must fail loudly, and a real addition bumps `schemaVersion`.
 */
function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function failure(
  code: ExtensionSessionBackendFailureCode,
  detail: string,
): ExtensionSessionBackendParseResult {
  return { ok: false, code, detail };
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isVersionText(value: unknown): value is string {
  return typeof value === 'string' && VERSION.test(value);
}

function isPlatform(value: unknown): value is (typeof PLATFORMS)[number] {
  return PLATFORMS.some((platform) => platform === value);
}

function parseBackendId(
  value: unknown,
): { ok: true; id: string } | { ok: false; code: 'invalid-backend-id' | 'reserved-backend-id' } {
  // `isAgentPluginId` also rejects `pi`, so the reserved list is checked first
  // to report the more specific reason.
  if (typeof value === 'string' && RESERVED_EXTENSION_BACKEND_IDS.some((reserved) => reserved === value)) {
    return { ok: false, code: 'reserved-backend-id' };
  }
  return isAgentPluginId(value)
    ? { ok: true, id: value }
    : { ok: false, code: 'invalid-backend-id' };
}

function parseArtifact(value: unknown): ExtensionSessionBackendArtifact | ExtensionSessionBackendFailureCode {
  if (!isRecord(value) || !hasOnlyKeys(value, ARTIFACT_KEYS)) return 'invalid-artifact';
  if (value.format !== 'node-esm') return 'invalid-artifact';
  if (typeof value.sha256 !== 'string' || !DIGEST.test(value.sha256)) return 'invalid-artifact';
  if (typeof value.byteSize !== 'number' || !Number.isSafeInteger(value.byteSize) || value.byteSize < 1) {
    return 'invalid-artifact';
  }
  if (value.byteSize > AGENT_PLUGIN_MAX_ARTIFACT_BYTES) return 'artifact-too-large';
  const entrypoint = value.entrypoint;
  if (typeof entrypoint !== 'string' || !isAgentPluginRelativePath(entrypoint) ||
      !entrypoint.endsWith('.mjs')) return 'invalid-artifact-entrypoint';
  return { format: 'node-esm', entrypoint, sha256: value.sha256, byteSize: value.byteSize };
}

function isValidSvgViewBox(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = value.trim().split(/[\s,]+/);
  if (parts.length !== 4) return false;
  const nums = parts.map((part) => Number(part));
  if (!nums.every((num) => Number.isFinite(num))) return false;
  return (nums[2] ?? 0) > 0 && (nums[3] ?? 0) > 0;
}

function parseIcon(value: unknown): ExtensionSessionBackendIcon | 'invalid-icon' | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return 'invalid-icon';
  if (value.kind === 'brand') {
    if (!hasOnlyKeys(value, BRAND_ICON_KEYS)) return 'invalid-icon';
    if (typeof value.id !== 'string' || !ICON_BRAND_SLUG.test(value.id)) return 'invalid-icon';
    return { kind: 'brand', id: value.id };
  }
  if (value.kind === 'glyph') {
    if (!hasOnlyKeys(value, GLYPH_ICON_KEYS)) return 'invalid-icon';
    if (!isValidSvgViewBox(value.viewBox)) return 'invalid-icon';
    if (!Array.isArray(value.paths) || value.paths.length === 0 || value.paths.length > ICON_MAX_PATHS) {
      return 'invalid-icon';
    }
    let totalLength = 0;
    const paths: string[] = [];
    for (const entry of value.paths) {
      if (typeof entry !== 'string') return 'invalid-icon';
      const trimmed = entry.trim();
      if (trimmed.length === 0 || !SVG_PATH_DATA.test(trimmed)) return 'invalid-icon';
      totalLength += trimmed.length;
      if (totalLength > ICON_MAX_TOTAL_PATH_LENGTH) return 'invalid-icon';
      paths.push(trimmed);
    }
    const fillRule = value.fillRule;
    if (fillRule !== undefined && fillRule !== 'nonzero' && fillRule !== 'evenodd') {
      return 'invalid-icon';
    }
    return {
      kind: 'glyph',
      viewBox: value.viewBox.trim().split(/[\s,]+/).join(' '),
      paths,
      ...(fillRule !== undefined ? { fillRule } : {}),
    };
  }
  return 'invalid-icon';
}

/**
 * Backend ids claimed by more than one enabled extension.
 *
 * `SessionBackendBinding.agentId` must resolve to exactly one implementation,
 * so the Host refuses the set instead of picking a winner. This mirrors the
 * duplicate auth-provider rule and is pure so the rule is testable without I/O.
 * An empty result means every claim is unique.
 */
export function findDuplicateExtensionBackendIds(
  declarations: readonly ExtensionSessionBackendDeclaration[],
): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const declaration of declarations) {
    if (seen.has(declaration.id)) duplicates.add(declaration.id);
    seen.add(declaration.id);
  }
  return [...duplicates].sort();
}

/**
 * Parse the `sessionBackend` value from an extension's `piwin.json`.
 *
 * Returns `undefined` when the extension is not a backend, which is the normal
 * case for tool, hook and OAuth-provider extensions.
 */
export function parseExtensionSessionBackend(
  value: unknown,
): ExtensionSessionBackendParseResult | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return failure('not-an-object', 'sessionBackend must be an object');
  if (!hasOnlyKeys(value, DECLARATION_KEYS)) {
    const unknown = Object.keys(value).filter((key) => !DECLARATION_KEYS.includes(key));
    return failure('unknown-key', `unknown sessionBackend keys: ${unknown.join(', ')}`);
  }
  if (value.schemaVersion !== EXTENSION_SESSION_BACKEND_SCHEMA_VERSION) {
    return failure('unsupported-schema', `schemaVersion must be ${EXTENSION_SESSION_BACKEND_SCHEMA_VERSION}`);
  }
  const id = parseBackendId(value.id);
  if (!id.ok) {
    return failure(
      id.code,
      id.code === 'reserved-backend-id'
        ? `sessionBackend.id "${String(value.id)}" is reserved`
        : 'sessionBackend.id must be a lowercase slug',
    );
  }
  if (!isNonEmptyText(value.name) || value.name.length > NAME_MAX_LENGTH) {
    return failure('invalid-name', 'name must be a non-empty string of at most 120 characters');
  }
  if (value.description !== undefined && (typeof value.description !== 'string' || value.description.length > 500)) {
    return failure('invalid-name', 'description must be a string of at most 500 characters');
  }
  const icon = parseIcon(value.icon);
  if (icon === 'invalid-icon') {
    return failure('invalid-icon', 'icon must be a valid brand slug or bounded monochrome SVG glyph');
  }
  if (!isNonEmptyText(value.helpUrl)) {
    return failure('invalid-name', 'helpUrl must be a non-empty string');
  }
  if (!isVersionText(value.version)) {
    return failure('invalid-version', 'version must look like 1.2.3');
  }
  if (!isVersionText(value.minHostVersion)) {
    return failure('invalid-version', 'minHostVersion must look like 1.2.3');
  }
  if (value.protocol !== 'piwin-agent-stdio') {
    return failure('unsupported-protocol', 'protocol must be "piwin-agent-stdio"');
  }
  if (value.protocolVersion !== AGENT_PLUGIN_PROTOCOL_VERSION) {
    return failure('unsupported-protocol-version', `protocolVersion must be ${AGENT_PLUGIN_PROTOCOL_VERSION}`);
  }
  const minHostProtocolVersion = value.minHostProtocolVersion;
  if (typeof minHostProtocolVersion !== 'number' || !Number.isSafeInteger(minHostProtocolVersion) ||
      minHostProtocolVersion < 0 || minHostProtocolVersion > AGENT_PLUGIN_PROTOCOL_VERSION) {
    return failure(
      'unsupported-protocol-version',
      `minHostProtocolVersion must be an integer between 0 and ${AGENT_PLUGIN_PROTOCOL_VERSION}`,
    );
  }
  const platforms = value.platforms;
  if (!Array.isArray(platforms) || platforms.length === 0 || platforms.length > PLATFORMS.length ||
      !platforms.every(isPlatform) || new Set(platforms).size !== platforms.length) {
    return failure('unsupported-platform', 'platforms must be a non-empty duplicate-free subset of darwin, win32, linux');
  }
  const verifiedCliVersions = value.verifiedCliVersions;
  if (!Array.isArray(verifiedCliVersions) || !verifiedCliVersions.every(isVersionText)) {
    return failure('invalid-version', 'verifiedCliVersions must be a list of 1.2.3 strings');
  }
  const artifact = parseArtifact(value.artifact);
  if (typeof artifact === 'string') {
    return failure(
      artifact,
      artifact === 'invalid-artifact-entrypoint'
        ? 'artifact.entrypoint must be a safe relative .mjs path'
        : artifact === 'artifact-too-large'
          ? `artifact.byteSize must not exceed ${AGENT_PLUGIN_MAX_ARTIFACT_BYTES}`
          : 'artifact must be a node-esm object with sha256 and byteSize',
    );
  }
  const compatibleRevisions = value.compatibleRevisions;
  if (!Array.isArray(compatibleRevisions) || !compatibleRevisions.every((revision) =>
    typeof revision === 'string' && DIGEST.test(revision))) {
    return failure('invalid-version', 'compatibleRevisions must be a list of lowercase 64-character hex digests');
  }
  if (typeof value.unversionedBindingCompatible !== 'boolean') {
    return failure('invalid-artifact', 'unversionedBindingCompatible must be a boolean');
  }
  const outputDirectories = parseOutputDirectories(value.outputDirectories);
  if (outputDirectories === undefined) {
    return failure(
      'invalid-output-directory',
      'outputDirectories must be a bounded duplicate-free list of valid directories',
    );
  }
  return {
    ok: true,
    declaration: {
      schemaVersion: EXTENSION_SESSION_BACKEND_SCHEMA_VERSION,
      id: id.id,
      name: value.name,
      ...(isNonEmptyText(value.description) ? { description: value.description.trim() } : {}),
      ...(icon !== undefined ? { icon } : {}),
      version: value.version,
      minHostVersion: value.minHostVersion,
      protocol: 'piwin-agent-stdio',
      protocolVersion: AGENT_PLUGIN_PROTOCOL_VERSION,
      minHostProtocolVersion,
      platforms: [...platforms] as ExtensionSessionBackendDeclaration['platforms'],
      verifiedCliVersions: [...verifiedCliVersions],
      helpUrl: value.helpUrl,
      artifact,
      compatibleRevisions: [...compatibleRevisions],
      unversionedBindingCompatible: value.unversionedBindingCompatible,
      outputDirectories,
    },
  };
}

/** An enabled extension that contributes one session backend. */
export type EnabledExtensionSessionBackend = {
  extensionId: string;
  agentId: string;
  name: string;
  description?: string;
  icon?: ExtensionSessionBackendIcon;
};

/** Any installed extension that contributes a session backend (enabled or disabled). */
export type InstalledExtensionSessionBackend = EnabledExtensionSessionBackend & {
  enabled: boolean;
};

type ExtensionSessionBackendInput = {
  id: string;
  enabled: boolean;
  description?: string;
  sessionBackend?: {
    id: string;
    name: string;
    description?: string;
    icon?: ExtensionSessionBackendIcon;
  };
};

function projectBackendEntry(extension: ExtensionSessionBackendInput): InstalledExtensionSessionBackend | undefined {
  const backend = extension.sessionBackend;
  if (backend === undefined) return undefined;
  const description =
    (backend.description && backend.description.trim()) ||
    (extension.description && extension.description !== '(session backend)' ? extension.description.trim() : undefined);
  return {
    extensionId: extension.id,
    agentId: backend.id,
    name: backend.name,
    enabled: extension.enabled,
    ...(description ? { description } : {}),
    ...(backend.icon !== undefined ? { icon: backend.icon } : {}),
  };
}

/**
 * Installed session backends across all extensions (enabled first, then disabled),
 * so historical session rows still resolve a disabled backend's name and icon.
 */
export function installedExtensionSessionBackends(
  extensions: readonly ExtensionSessionBackendInput[],
): InstalledExtensionSessionBackend[] {
  const seen = new Set<string>();
  const entries: InstalledExtensionSessionBackend[] = [];
  for (const pass of [true, false]) {
    for (const extension of extensions) {
      if (extension.enabled !== pass) continue;
      const projected = projectBackendEntry(extension);
      if (projected === undefined || seen.has(projected.agentId)) continue;
      seen.add(projected.agentId);
      entries.push(projected);
    }
  }
  return entries;
}

/**
 * Session-start entries come only from enabled extension declarations.
 * A disabled extension, a tool extension, and a second declaration of the
 * same backend id do not create another entry.
 */
export function enabledExtensionSessionBackends(
  extensions: readonly ExtensionSessionBackendInput[],
): EnabledExtensionSessionBackend[] {
  const seen = new Set<string>();
  const entries: EnabledExtensionSessionBackend[] = [];
  for (const extension of extensions) {
    if (!extension.enabled) continue;
    const projected = projectBackendEntry(extension);
    if (projected === undefined || seen.has(projected.agentId)) continue;
    seen.add(projected.agentId);
    const { enabled: _enabled, ...entry } = projected;
    entries.push(entry);
  }
  return entries;
}
