/**
 * Registry and deployment document codec for the managed extension store.
 * Pure: parses untrusted JSON into contracts shapes and derives the content
 * revision; all file I/O stays in the store.
 */
import { createHash } from 'node:crypto';
import type {
  ExtensionDeploymentPhase,
  ExtensionDeploymentRecord,
  ExtensionRegistryDocument,
  InstalledExtensionRecord,
  ManagedExtensionRevision,
} from '@piwin/contracts';
import { normalizeResourceId } from '@piwin/contracts';

export const REGISTRY_VERSION = 1 as const;

export function createEmptyRegistry(): ExtensionRegistryDocument {
  return {
    version: REGISTRY_VERSION,
    revision: computeRegistryRevision({}),
    extensions: {},
  };
}

export function parseRegistry(value: unknown): ExtensionRegistryDocument {
  if (!isRecord(value) || value.version !== REGISTRY_VERSION || !isRecord(value.extensions)) {
    throw new Error('Invalid managed extension registry');
  }
  const extensions: Record<string, InstalledExtensionRecord> = {};
  for (const [id, rawRecord] of Object.entries(value.extensions)) {
    const record = parseRecord(id, rawRecord);
    extensions[record.id] = record;
  }
  return {
    version: REGISTRY_VERSION,
    revision: computeRegistryRevision(extensions),
    extensions,
  };
}

export function parseRecord(id: string, value: unknown): InstalledExtensionRecord {
  if (!isRecord(value)) throw new Error(`Invalid managed extension record: ${id}`);
  const recordId =
    typeof value.id === 'string' ? normalizeResourceId(value.id) : normalizeResourceId(id);
  if (
    typeof value.name !== 'string' ||
    typeof value.description !== 'string' ||
    typeof value.configuredEnabled !== 'boolean' ||
    !Array.isArray(value.revisions)
  ) {
    throw new Error(`Invalid managed extension record: ${id}`);
  }
  const revisions = value.revisions.map((candidate) => parseRevision(recordId, candidate));
  const selectedRevision =
    typeof value.selectedRevision === 'string' ? value.selectedRevision : undefined;
  const lastKnownGoodRevision =
    typeof value.lastKnownGoodRevision === 'string' ? value.lastKnownGoodRevision : undefined;
  return {
    id: recordId,
    name: value.name,
    description: value.description,
    configuredEnabled: value.configuredEnabled,
    ...(selectedRevision ? { selectedRevision } : {}),
    ...(lastKnownGoodRevision ? { lastKnownGoodRevision } : {}),
    revisions,
    ...(value.installationState === 'pending-removal'
      ? { installationState: 'pending-removal' as const }
      : {}),
  };
}

export function parseRevision(extensionId: string, value: unknown): ManagedExtensionRevision {
  if (!isRecord(value)) throw new Error(`Invalid managed extension revision: ${extensionId}`);
  if (
    typeof value.extensionId !== 'string' ||
    typeof value.contentRevision !== 'string' ||
    typeof value.entryPath !== 'string' ||
    typeof value.packageRoot !== 'string' ||
    (value.state !== 'installed' && value.state !== 'quarantined') ||
    typeof value.installedAt !== 'string'
  ) {
    throw new Error(`Invalid managed extension revision: ${extensionId}`);
  }
  return {
    extensionId,
    contentRevision: value.contentRevision,
    entryPath: value.entryPath,
    packageRoot: value.packageRoot,
    state: value.state,
    installedAt: value.installedAt,
    ...(typeof value.version === 'string' ? { version: value.version } : {}),
    ...(typeof value.sourceLocator === 'string' ? { sourceLocator: value.sourceLocator } : {}),
    ...(typeof value.integrity === 'string' ? { integrity: value.integrity } : {}),
  };
}

export function parseDeployment(value: unknown): ExtensionDeploymentRecord {
  if (!isRecord(value)) throw new Error('Invalid extension deployment record');
  const phase = value.phase;
  const when = value.when;
  if (
    typeof value.deploymentId !== 'string' ||
    typeof value.sessionId !== 'string' ||
    typeof value.targetRegistryRevision !== 'string' ||
    (when !== 'now' && when !== 'after-current-run' && when !== 'new-sessions-only') ||
    !isExtensionDeploymentPhase(phase) ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new Error('Invalid extension deployment record');
  }
  return {
    deploymentId: value.deploymentId,
    sessionId: value.sessionId,
    targetRegistryRevision: value.targetRegistryRevision,
    ...(typeof value.targetExtensionSetRevision === 'string'
      ? { targetExtensionSetRevision: value.targetExtensionSetRevision }
      : {}),
    ...(typeof value.expectedSettingsRevision === 'string'
      ? { expectedSettingsRevision: value.expectedSettingsRevision }
      : {}),
    when,
    phase,
    ...(typeof value.generationId === 'string' ? { generationId: value.generationId } : {}),
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function computeRegistryRevision(extensions: Record<string, InstalledExtensionRecord>): string {
  const canonical = Object.values(extensions)
    .map((record) => ({
      ...record,
      revisions: [...record.revisions].sort((left, right) =>
        left.contentRevision.localeCompare(right.contentRevision),
      ),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function cloneRecord(record: InstalledExtensionRecord): InstalledExtensionRecord {
  return {
    ...record,
    ...(record.selectedRevision ? { selectedRevision: record.selectedRevision } : {}),
    ...(record.lastKnownGoodRevision
      ? { lastKnownGoodRevision: record.lastKnownGoodRevision }
      : {}),
    revisions: record.revisions.map((revision) => ({ ...revision })),
  };
}

export function isExtensionDeploymentPhase(value: unknown): value is ExtensionDeploymentPhase {
  return (
    value === 'queued' ||
    value === 'validating' ||
    value === 'waiting-current-run' ||
    value === 'compiling' ||
    value === 'creating-runtime' ||
    value === 'publishing' ||
    value === 'active' ||
    value === 'failed' ||
    value === 'rolled-back' ||
    value === 'restart-required' ||
    value === 'superseded'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
