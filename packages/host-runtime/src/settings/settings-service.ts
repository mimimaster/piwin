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
import { isRedactedStoredSecret, PIWIN_SETTINGS_SCHEMA_VERSION } from '@piwin/contracts';
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
    readonly conflictingDomains: SettingsDomain[] = [],
    readonly snapshot?: SettingsSnapshot,
  ) {
    super(
      `Settings changed since revision ${expectedRevision}; current revision is ${actualRevision}`,
    );
  }
}

/**
 * Settings domains whose values are compiled into a new Agent Runtime
 * generation. Desktop restore/composer state and immediate-only service
 * preferences intentionally do not participate in this revision: they may
 * advance the durable Settings document without invalidating a resident
 * generation.
 *
 * Keep this list aligned with `classifySettingsImpact`'s `new-runtime`
 * domains. The full document revision remains the optimistic-concurrency
 * token; this projection is only for runtime generation identity.
 */
const RUNTIME_REVISION_DOMAINS = [
  'providers',
  'defaultProviderId',
  'defaultModelId',
  'thinking',
  'web',
  'skills',
  'extensions',
  'prompts',
  'compaction',
  'process',
  'session',
  'notes',
  'flashcards',
  'marketplace',
  'imageGeneration',
  'videoGeneration',
  'speech',
  'permissions',
  'walkthrough',
  'subagents',
  'remote',
] as const satisfies readonly (keyof PiwinConfig)[];

type SettingsServiceOptions = {
  piwinRoot?: string | undefined;
};

/**
 * Owns all V2 settings reads and domain mutations. The service intentionally
 * keeps the existing PiwinConfig shape during Phase 1; later phases can move
 * capability fields without reintroducing whole-document writes.
 */
/**
 * One chain per data root. Catalog commands construct a new SettingsService
 * per request; concurrent remote applies must still rebase, not race the file.
 */
const mutationChains = new Map<string, Promise<unknown>>();

export class SettingsService {
  private readonly rootDir: string;

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
    const previous = mutationChains.get(this.rootDir) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    // A failed mutation must never wedge the chain; later applies still run.
    mutationChains.set(
      this.rootDir,
      result.catch(() => undefined),
    );
    return result;
  }

  private async applyMutation(input: ApplySettingsInput): Promise<SettingsApplyResult> {
    const currentSnapshot = await this.getSnapshot();
    if (
      input.expectedRevision !== undefined &&
      input.expectedRevision !== currentSnapshot.revision
    ) {
      const conflictingDomains = collectConflictingDomains(currentSnapshot, input);
      if (conflictingDomains.length > 0) {
        throw new SettingsRevisionConflictError(
          input.expectedRevision,
          currentSnapshot.revision,
          conflictingDomains,
          currentSnapshot,
        );
      }
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
    runtimeRevision: createRuntimeSettingsRevision(normalizedConfig),
    domainRevisions: createSettingsDomainRevisions(normalizedConfig),
    config: normalizedConfig,
  };
}

export function createSettingsDomainRevision(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

export function createSettingsDomainRevisions(
  config: PiwinConfig,
): Partial<Record<SettingsDomain, string>> {
  const normalized = normalizePiwinConfig(config);
  const revisions: Partial<Record<SettingsDomain, string>> = {};
  for (const domain of [
    'hostMode',
    'agentMock',
    'providers',
    'defaultProviderId',
    'defaultModelId',
    'thinking',
    'desktop',
    'media',
    'artifact',
    'web',
    'skills',
    'extensions',
    'prompts',
    'compaction',
    'process',
    'session',
    'notes',
    'flashcards',
    'automation',
    'marketplace',
    'imageGeneration',
    'speech',
    'visionDelegation',
    'replyWriter',
    'permissions',
    'walkthrough',
    'subagents',
    'remote',
  ] as const satisfies readonly SettingsDomain[]) {
    revisions[domain] = createSettingsDomainRevision(readConfigDomain(normalized, domain));
  }
  return revisions;
}

function collectConflictingDomains(
  current: SettingsSnapshot,
  input: ApplySettingsInput,
): SettingsDomain[] {
  const mutated = [...new Set(input.mutations.map((mutation) => mutation.domain))];
  const expected = input.expectedDomainRevisions;
  if (expected === undefined) {
    return mutated;
  }
  return mutated.filter((domain) => {
    const expectedHash = expected[domain];
    if (expectedHash === undefined) {
      return true;
    }
    return current.domainRevisions[domain] !== expectedHash;
  });
}

/**
 * Compute the revision used by Agent Runtime replacement and candidate
 * validation. This deliberately hashes a projection rather than the whole
 * product config so Desktop-only persistence cannot invalidate a resident
 * runtime that does not consume it.
 */
export function createRuntimeSettingsRevision(config: PiwinConfig): string {
  const normalizedConfig = normalizePiwinConfig(config);
  const runtimeConfig = Object.fromEntries(
    RUNTIME_REVISION_DOMAINS.map((domain) => [domain, normalizedConfig[domain]]),
  );
  const canonicalRuntimeConfig = {
    schemaVersion: PIWIN_SETTINGS_SCHEMA_VERSION,
    config: runtimeConfig,
  };
  return createHash('sha256')
    .update(JSON.stringify(canonicalRuntimeConfig))
    .digest('hex');
}

/**
 * Remote settings/get strips secrets and Host paths. A later replace-domain
 * must keep those omitted fields or apply would wipe them / fail validation.
 *
 * Arrays of `{ id }` records merge by id (source order in a projected web
 * domain is not authoritative). Host-held launchers that the shell omitted
 * entirely stay on disk — toggling a source sets `enabled`, it does not drop
 * the row.
 */
function mergeMissingDomainFields(current: unknown, incoming: unknown): unknown {
  if (incoming === undefined) {
    return current;
  }
  if (isRedactedHostPath(incoming) && typeof current === 'string' && current.length > 0) {
    return current;
  }
  if (isRedactedStoredSecret(incoming) && typeof current === 'string' && current.length > 0) {
    return current;
  }
  if (incoming === null || typeof incoming !== 'object') {
    return incoming;
  }
  if (Array.isArray(incoming)) {
    if (!Array.isArray(current)) {
      return incoming;
    }
    if (canMergeRecordsById(current, incoming)) {
      return mergeIdRecordArrays(current, incoming);
    }
    return incoming.map((item, index) => mergeMissingDomainFields(current[index], item));
  }
  if (current === null || typeof current !== 'object' || Array.isArray(current)) {
    return incoming;
  }
  const currentRecord = current as Record<string, unknown>;
  const incomingRecord = incoming as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...currentRecord };
  for (const [key, value] of Object.entries(incomingRecord)) {
    merged[key] = mergeMissingDomainFields(currentRecord[key], value);
  }
  return merged;
}

export function applySettingsMutations(
  config: PiwinConfig,
  mutations: SettingsMutation[],
): PiwinConfig {
  let nextConfig = normalizePiwinConfig(config);
  for (const mutation of mutations) {
    nextConfig = {
      ...nextConfig,
      [mutation.domain]: mergeMissingDomainFields(
        readConfigDomain(nextConfig, mutation.domain),
        mutation.value,
      ),
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
    'replyWriter',
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
    case 'providers':
      // Deleting or disabling the delegate model is a providers mutation, but
      // it revokes the Host web_search backend (the delegate is its exclusive
      // backend when configured). Apply the same immediate rule as `web`.
      return hasUsableWebSearch(previous) && !hasUsableWebSearch(next) ? ['web-search'] : [];
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
 * Whether the Host external `web_search` backend is usable for a generation.
 *
 * The `web-search` immediate restriction clamps exactly the Host `web_search`
 * tool family, so this mirrors the production external-readiness rule
 * (`evaluateSearchReadiness`): a configured delegate is the tool's exclusive
 * backend and fails closed when stale (`findReadyWebSearchDelegate`); enabled
 * ordinary sources back the tool only when no delegate is configured. Model
 * native search is per-session request shaping and cannot be revoked
 * mid-generation, so it never counts as usability here. Under `native-only`
 * the external tool is never exposed, so there is nothing to restrict.
 */
function hasUsableWebSearch(config: PiwinConfig): boolean {
  const web = config.web;
  if (!web) return false;
  if (web.searchRoutePolicy === 'native-only') {
    return false;
  }
  const delegateConfigured = web.searchDelegateModel !== undefined;
  return delegateConfigured
    ? findReadyWebSearchDelegate(config) !== undefined
    : (web.searchSources ?? []).some((source) => source.enabled);
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

function isIdRecord(value: unknown): value is Record<string, unknown> & { id: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'id' in value;
}

function isRedactedHostPath(value: unknown): boolean {
  return typeof value === 'string' && value.includes('[host-path]');
}

function hasHostHeldFields(value: unknown): boolean {
  if (!isIdRecord(value)) {
    return false;
  }
  return ['command', 'apiKeyRef', 'apiKeyEnv'].some((key) => {
    const field = value[key];
    return typeof field === 'string' && field.trim().length > 0;
  });
}

function canMergeRecordsById(current: unknown[], incoming: unknown[]): boolean {
  const currentIds = current.filter(isIdRecord).map((item) => String(item.id));
  const incomingIds = incoming.filter(isIdRecord).map((item) => String(item.id));
  return (
    currentIds.length === current.length &&
    incomingIds.length === incoming.length &&
    new Set(currentIds).size === currentIds.length
  );
}

function mergeIdRecordArrays(current: unknown[], incoming: unknown[]): unknown[] {
  const currentById = new Map(
    current.filter(isIdRecord).map((item) => [String(item.id), item] as const),
  );
  const merged = incoming.map((item) => {
    if (!isIdRecord(item)) {
      return item;
    }
    const prior = currentById.get(String(item.id));
    return prior === undefined ? item : mergeMissingDomainFields(prior, item);
  });
  const incomingIds = new Set(incoming.filter(isIdRecord).map((item) => String(item.id)));
  for (const item of current) {
    if (!isIdRecord(item) || incomingIds.has(String(item.id)) || !hasHostHeldFields(item)) {
      continue;
    }
    merged.push(item);
  }
  return merged;
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
