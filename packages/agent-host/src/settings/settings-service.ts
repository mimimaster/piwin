import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  ApplySettingsInput,
  PiwinConfig,
  SettingsApplyResult,
  SettingsDomain,
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

  constructor(options: SettingsServiceOptions = {}) {
    this.rootDir = getPiwinRoot(options.piwinRoot);
  }

  async getSnapshot(): Promise<SettingsSnapshot> {
    const config = await loadPiwinConfig(this.rootDir);
    return createSettingsSnapshot(config);
  }

  async apply(input: ApplySettingsInput): Promise<SettingsApplyResult> {
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
    return {
      snapshot: nextSnapshot,
      changedDomains: input.mutations.map((mutation) => classifySettingsImpact(mutation.domain)),
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

function classifySettingsImpact(domain: SettingsDomain) {
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
  return {
    domain,
    timing,
    securityTightenedImmediately: domain === 'permissions',
  } as const;
}

async function writeValidatedConfigAtomically(
  config: PiwinConfig,
  configPath: string,
): Promise<void> {
  const issues = validatePiwinConfig(config);
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
