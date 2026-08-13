import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  ApplySettingsInput,
  ImmediateCapabilityRestriction,
  PiwinConfig,
  SettingsApplyResult,
  SettingsDomain,
  SettingsDomainImpact,
  SettingsMutation,
  SettingsSnapshot,
} from '@piwin/contracts';
import { PIWIN_SETTINGS_SCHEMA_VERSION } from '@piwin/contracts';
import { getPiwinConfigPath, getPiwinRoot } from '../paths.js';
import {
  createDefaultPiwinConfig,
  loadPiwinConfig,
  normalizePiwinConfig,
} from '../config-store.js';
import { sanitizeProvidersForSave, validatePiwinConfig } from '../provider-validation.js';
import { isBlockingValidationIssue } from '../provider-validation.js';
import { findReadyWebSearchDelegate } from '../capabilities/search-route-resolver.js';

export class SettingsRevisionConflictError extends Error {
  readonly name = 'SettingsRevisionConflictError';

  constructor(
    readonly expectedRevision: string,
    readonly actualRevision: string,
  ) {
    super(
      `Settings changed since revision ${expectedRevision}; current revision is ${actualRevision}`,
    );
  }
}

type SettingsServiceOptions = {
  piwinRoot?: string | undefined;
};

/**
 * Owns all V2 settings reads and domain mutations. The service intentionally
 * keeps the existing PiwinConfig shape during Phase 1; later phases can move
 * capability fields without reintroducing whole-document writes.
 */
export class SettingsService {
  private readonly rootDir: string;
  /**
   * Process-local mutation mutex. The CLI dispatcher already serializes
   * `settings/apply`, but the service must not silently lose updates when two
   * writers (panels, tests, future transports) race the same base revision:
   * the read-modify-write cycle is atomic only within this chain.
   */
  private mutationChain: Promise<unknown> = Promise.resolve();

  constructor(options: SettingsServiceOptions = {}) {
    this.rootDir = getPiwinRoot(options.piwinRoot);
  }

  async getSnapshot(): Promise<SettingsSnapshot> {
    const config = await loadPiwinConfig(this.rootDir);
    return createSettingsSnapshot(config);
  }

  apply(input: ApplySettingsInput): Promise<SettingsApplyResult> {
    return this.runSerialized(() => this.applyMutation(input));
  }

  private runSerialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationChain.then(operation, operation);
    // A failed mutation must never wedge the chain; later applies still run.
    this.mutationChain = result.catch(() => undefined);
    return result;
  }

  private async applyMutation(input: ApplySettingsInput): Promise<SettingsApplyResult> {
    const currentSnapshot = await this.getSnapshot();
    if (
      input.expectedRevision !== undefined &&
      input.expectedRevision !== currentSnapshot.revision
    ) {
      throw new SettingsRevisionConflictError(input.expectedRevision, currentSnapshot.revision);
    }

    const nextConfig = applySettingsMutations(currentSnapshot.config, input.mutations);
    const nextSnapshot = createSettingsSnapshot(nextConfig);
    if (nextSnapshot.revision === currentSnapshot.revision) {
      return {
        snapshot: currentSnapshot,
        changedDomains: [],
      };
    }

    await writeValidatedConfigAtomically(nextConfig, getPiwinConfigPath(this.rootDir));
    const changedDomains = input.mutations
      .filter(
        (mutation, index, mutations) =>
          mutations.findIndex((candidate) => candidate.domain === mutation.domain) === index &&
          JSON.stringify(readConfigDomain(currentSnapshot.config, mutation.domain)) !==
            JSON.stringify(readConfigDomain(nextSnapshot.config, mutation.domain)),
      )
      .map((mutation) =>
        classifySettingsImpact(mutation.domain, currentSnapshot.config, nextSnapshot.config),
      );
    return {
      snapshot: nextSnapshot,
      changedDomains,
    };
  }
}

export function createSettingsSnapshot(config: PiwinConfig): SettingsSnapshot {
  const normalizedConfig = normalizePiwinConfig(config);
  const canonicalConfig = {
    schemaVersion: PIWIN_SETTINGS_SCHEMA_VERSION,
    config: normalizedConfig,
  };
  const revision = createHash('sha256').update(JSON.stringify(canonicalConfig)).digest('hex');
  return {
    schemaVersion: PIWIN_SETTINGS_SCHEMA_VERSION,
    revision,
    config: normalizedConfig,
  };
}

export function applySettingsMutations(
  config: PiwinConfig,
  mutations: SettingsMutation[],
): PiwinConfig {
  let nextConfig = normalizePiwinConfig(config);
  for (const mutation of mutations) {
    nextConfig = {
      ...nextConfig,
      [mutation.domain]: mutation.value,
    } as PiwinConfig;
  }
  return normalizePiwinConfig(nextConfig);
}

export function classifySettingsImpact(
  domain: SettingsDomain,
  previous: PiwinConfig,
  next: PiwinConfig,
): SettingsDomainImpact {
  const immediateDomains = new Set<SettingsDomain>([
    'media',
    'artifact',
    'visionDelegation',
    'automation',
    'desktop',
  ]);
  const hostRestartDomains = new Set<SettingsDomain>(['hostMode', 'agentMock']);
  const timing = hostRestartDomains.has(domain)
    ? 'host-restart'
    : immediateDomains.has(domain)
      ? 'immediate'
      : 'new-runtime';
  const immediateRestrictions = findImmediateRestrictions(domain, previous, next);
  return {
    domain,
    timing,
    runtimeSchemaChanged: timing === 'new-runtime',
    immediateRestrictions,
    securityTightenedImmediately: immediateRestrictions.length > 0,
  };
}

function findImmediateRestrictions(
  domain: SettingsDomain,
  previous: PiwinConfig,
  next: PiwinConfig,
): ImmediateCapabilityRestriction[] {
  switch (domain) {
    case 'web': {
      const restrictions: ImmediateCapabilityRestriction[] = [];
      if (hasUsableWebSearch(previous) && !hasUsableWebSearch(next)) {
        restrictions.push('web-search');
      }
      const previousBlockedPrefixes = new Set(previous.web?.fetchBlockedUrlPrefixes ?? []);
      const nextIntroducesBlockedPrefix = (next.web?.fetchBlockedUrlPrefixes ?? []).some(
        (prefix) => !previousBlockedPrefixes.has(prefix),
      );
      if (nextIntroducesBlockedPrefix) {
        restrictions.push('web-fetch');
      }
      return restrictions;
    }
    case 'process':
      return previous.process?.enabled !== false && next.process?.enabled === false
        ? ['process']
        : [];
    case 'notes':
      return previous.notes?.enabled !== false && next.notes?.enabled === false
        ? ['notes-write']
        : [];
    case 'flashcards':
      return previous.flashcards?.enabled !== false && next.flashcards?.enabled === false
        ? ['flashcards-write']
        : [];
    case 'permissions':
      return permissionModeRank(next.permissions?.mode) >
        permissionModeRank(previous.permissions?.mode)
        ? ['permission-policy']
        : [];
    case 'subagents': {
      const previousProfileIds = new Set(
        previous.subagents?.profiles.map((profile) => profile.id) ?? [],
      );
      const nextProfileIds = new Set(next.subagents?.profiles.map((profile) => profile.id) ?? []);
      for (const profileId of previousProfileIds) {
        if (!nextProfileIds.has(profileId)) {
          return ['delegate'];
        }
      }
      return [];
    }
    default:
      return [];
  }
}

/**
 * Whether the config can actually route web search for a generation.
 *
 * Native readiness reuses the production resolver (`findReadyWebSearchDelegate`):
 * the delegate reference only counts when its provider exists and is enabled,
 * the model exists, is enabled, is tagged `native-web-search`, the protocol
 * matches, and the active adapter can express the native search request. A
 * stale reference to a deleted/disabled model must not keep reporting web
 * search as usable (false negative on immediate restriction).
 */
function hasUsableWebSearch(config: PiwinConfig): boolean {
  const web = config.web;
  if (!web) return false;
  const hasExternalSource = (web.searchSources ?? []).some((source) => source.enabled);
  const hasNativeSource = findReadyWebSearchDelegate(config) !== undefined;
  switch (web.searchRoutePolicy) {
    case 'native-only':
      return hasNativeSource;
    case 'external-only':
      return hasExternalSource;
    case 'native-first':
    case 'external-first':
      return hasNativeSource || hasExternalSource;
    default:
      return hasExternalSource || hasNativeSource;
  }
}

function permissionModeRank(mode: 'auto' | 'ask-all' | 'bypass' | undefined): number {
  switch (mode) {
    case 'bypass':
      return 0;
    case 'auto':
      return 1;
    case 'ask-all':
      return 2;
    default:
      return 1;
  }
}

function readConfigDomain(config: PiwinConfig, domain: SettingsDomain): unknown {
  // MCP is a separate persisted document and is intentionally absent from
  // PiwinConfig. Its SettingsDomain exists only for runtime invalidation.
  if (domain === 'mcp') return undefined;
  return (config as unknown as Record<string, unknown>)[domain];
}

async function writeValidatedConfigAtomically(
  config: PiwinConfig,
  configPath: string,
): Promise<void> {
  const issues = validatePiwinConfig(config).filter(isBlockingValidationIssue);
  if (issues.length > 0) {
    throw new Error(
      `Invalid providers: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`,
    );
  }
  const { providers, redactedFields } = sanitizeProvidersForSave(config.providers);
  if (redactedFields.length > 0) {
    throw new Error(
      `Refusing to save raw API keys in config (${redactedFields.join(', ')}). Use apiKeyEnv or apiKeyRef only.`,
    );
  }
  await mkdir(dirname(configPath), { recursive: true });
  const temporaryPath = join(
    dirname(configPath),
    `.${configPath.split('/').pop() ?? 'config.json'}.${process.pid}.tmp`,
  );
  const serialized = `${JSON.stringify(
    { schemaVersion: PIWIN_SETTINGS_SCHEMA_VERSION, ...config, providers },
    null,
    2,
  )}\n`;
  try {
    await writeFile(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, configPath);
  } catch (error) {
    try {
      await rename(temporaryPath, `${configPath}.failed-${process.pid}`);
    } catch {
      // Preserve the original write error; cleanup is best effort only.
    }
    throw error;
  }
}

export async function migrateSettingsDocument(piwinRoot?: string): Promise<SettingsSnapshot> {
  const rootDir = getPiwinRoot(piwinRoot);
  const configPath = getPiwinConfigPath(rootDir);
  try {
    const raw = await readFile(configPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const normalizedConfig = normalizePiwinConfig(parsed);
    const snapshot = createSettingsSnapshot(normalizedConfig);
    await writeValidatedConfigAtomically(normalizedConfig, configPath);
    return snapshot;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const snapshot = createSettingsSnapshot(createDefaultPiwinConfig());
      await writeValidatedConfigAtomically(snapshot.config, configPath);
      return snapshot;
    }
    throw error;
  }
}
