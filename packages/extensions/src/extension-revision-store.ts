import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import type {
  ExtensionDeploymentPhase,
  ExtensionDeploymentRecord,
  ExtensionRegistryDocument,
  ExtensionRevisionRef,
  ExtensionSource,
  InstalledExtensionRecord,
  ManagedExtensionRevision,
} from '@piwin/contracts';
import { normalizeResourceId } from '@piwin/contracts';

const REGISTRY_VERSION = 1 as const;
const REGISTRY_FILENAME = 'registry.json';
const REVISIONS_DIRECTORY = 'revisions';
const SOURCE_DIRECTORY = 'source';

export type StageExtensionRevisionInput = {
  sourcePath: string;
  name?: string;
  description?: string;
  source?: ExtensionSource;
  sourceLocator?: string;
  version?: string;
  integrity?: string;
};

export type StageExtensionRevisionResult = {
  extensionId: string;
  contentRevision: string;
  targetPath: string;
  packageRoot: string;
  registryRevision: string;
  record: InstalledExtensionRecord;
};

export type ExtensionRevisionStoreOptions = {
  piwinRoot: string;
};

/**
 * Host-owned immutable Pi Extension revision store.
 *
 * The store deliberately knows nothing about Pi execution. It only acquires
 * and records exact source trees; Host Runtime later decides whether a
 * revision is eligible for a Blueprint.
 */
export class ExtensionRevisionStore {
  private readonly rootDir: string;
  private readonly extensionsDir: string;
  private readonly registryPath: string;
  private readonly revisionsDir: string;
  private readonly deploymentsDir: string;
  /**
   * Process-local mutation chain. The CLI dispatcher serializes install /
   * set_enabled / apply commands, but the apply background continuation runs
   * outside that lane, so read-modify-write cycles on the registry document
   * must be atomic within the store itself.
   */
  private mutationChain: Promise<unknown> = Promise.resolve();

  constructor(options: ExtensionRevisionStoreOptions) {
    this.rootDir = resolve(options.piwinRoot);
    this.extensionsDir = join(this.rootDir, 'extensions');
    this.registryPath = join(this.extensionsDir, REGISTRY_FILENAME);
    this.revisionsDir = join(this.extensionsDir, REVISIONS_DIRECTORY);
    this.deploymentsDir = join(this.extensionsDir, 'deployments');
  }

  async readRegistry(): Promise<ExtensionRegistryDocument> {
    try {
      const raw = await readFile(this.registryPath, 'utf8');
      return parseRegistry(JSON.parse(raw) as unknown);
    } catch (error) {
      if (isMissingFile(error)) {
        return createEmptyRegistry();
      }
      throw error;
    }
  }

  async listRecords(): Promise<InstalledExtensionRecord[]> {
    const registry = await this.readRegistry();
    return Object.values(registry.extensions)
      .map((record) => cloneRecord(record))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async readDeployment(deploymentId: string): Promise<ExtensionDeploymentRecord | undefined> {
    try {
      const raw = await readFile(this.deploymentPath(deploymentId), 'utf8');
      return parseDeployment(JSON.parse(raw) as unknown);
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw error;
    }
  }

  async listDeployments(): Promise<ExtensionDeploymentRecord[]> {
    let entries: string[];
    try {
      entries = await readdir(this.deploymentsDir);
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
    const deployments: ExtensionDeploymentRecord[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const deployment = await this.readDeployment(entry.slice(0, -5));
      if (deployment) deployments.push(deployment);
    }
    return deployments.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async writeDeployment(record: ExtensionDeploymentRecord): Promise<ExtensionDeploymentRecord> {
    const deploymentPath = this.deploymentPath(record.deploymentId);
    await mkdir(this.deploymentsDir, { recursive: true });
    const temporaryPath = join(this.deploymentsDir, `.${record.deploymentId}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporaryPath, deploymentPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
    return { ...record };
  }

  async getRecord(extensionId: string): Promise<InstalledExtensionRecord | undefined> {
    const id = normalizeResourceId(extensionId);
    const registry = await this.readRegistry();
    const record = registry.extensions[id];
    return record ? cloneRecord(record) : undefined;
  }

  async stage(input: StageExtensionRevisionInput): Promise<StageExtensionRevisionResult> {
    const sourcePath = resolve(input.sourcePath);
    const sourceInfo = await inspectSource(sourcePath);
    const extensionName = input.name?.trim() || sourceInfo.defaultName;
    const extensionId = normalizeResourceId(extensionName);
    const files = await collectSourceFiles(sourcePath, sourceInfo.kind);
    const contentRevision = hashSourceFiles(files);
    const extensionSource = input.source ?? 'user';
    const now = new Date().toISOString();
    const revisionDirectory = join(this.revisionsDir, extensionId, contentRevision);
    const packageRoot = join(revisionDirectory, SOURCE_DIRECTORY);
    const entryPath =
      sourceInfo.kind === 'file' ? join(packageRoot, basename(sourcePath)) : packageRoot;
    const sourceLocator = input.sourceLocator?.trim() || undefined;

    await this.materializeRevision({
      sourcePath,
      kind: sourceInfo.kind,
      revisionDirectory,
      extensionId,
      contentRevision,
      ...((input.version ?? sourceInfo.version) !== undefined
        ? { version: input.version ?? sourceInfo.version }
        : {}),
      ...(sourceLocator ? { sourceLocator } : {}),
    });

    const revision: ManagedExtensionRevision = {
      extensionId,
      contentRevision,
      entryPath,
      packageRoot,
      state: 'installed',
      installedAt: now,
      ...((input.version ?? sourceInfo.version)
        ? { version: input.version ?? sourceInfo.version }
        : {}),
      ...(sourceLocator ? { sourceLocator } : {}),
      ...(input.integrity ? { integrity: input.integrity } : {}),
    };
    const registry = await this.mutate((current) => {
      const previous = current.extensions[extensionId];
      const existingRevision = previous?.revisions.find(
        (candidate) => candidate.contentRevision === contentRevision,
      );
      const nextRevision = existingRevision ?? revision;
      const nextRecord: InstalledExtensionRecord = {
        id: extensionId,
        name: extensionName,
        description: input.description ?? sourceInfo.description,
        configuredEnabled: previous?.configuredEnabled ?? false,
        ...(previous?.selectedRevision
          ? { selectedRevision: previous.selectedRevision }
          : { selectedRevision: contentRevision }),
        ...(previous?.lastKnownGoodRevision
          ? { lastKnownGoodRevision: previous.lastKnownGoodRevision }
          : {}),
        revisions: [
          ...(previous?.revisions.filter(
            (candidate) => candidate.contentRevision !== contentRevision,
          ) ?? []),
          nextRevision,
        ].sort((left, right) => left.installedAt.localeCompare(right.installedAt)),
      };
      return {
        ...current,
        extensions: { ...current.extensions, [extensionId]: nextRecord },
      };
    });
    const record = registry.extensions[extensionId];
    if (!record) {
      throw new Error(`Extension registry did not retain staged extension: ${extensionId}`);
    }
    return {
      extensionId,
      contentRevision,
      targetPath: entryPath,
      packageRoot,
      registryRevision: registry.revision,
      record: cloneRecord(record),
    };
  }

  async setEnabled(extensionId: string, enabled: boolean): Promise<ExtensionRegistryDocument> {
    const id = normalizeResourceId(extensionId);
    return this.mutate((current) => {
      const record = current.extensions[id];
      if (!record) {
        throw new Error(`Managed extension not found: ${id}`);
      }
      const selectedRevision =
        record.selectedRevision ?? latestInstalledRevision(record)?.contentRevision;
      if (enabled && !selectedRevision) {
        throw new Error(`Managed extension has no installed revision: ${id}`);
      }
      return {
        ...current,
        extensions: {
          ...current.extensions,
          [id]: {
            ...record,
            configuredEnabled: enabled,
            ...(selectedRevision ? { selectedRevision } : {}),
            revisions: record.revisions.map((revision) => ({ ...revision })),
          },
        },
      };
    });
  }

  async selectRevision(
    extensionId: string,
    contentRevision: string,
  ): Promise<ExtensionRegistryDocument> {
    const id = normalizeResourceId(extensionId);
    return this.mutate((current) => {
      const record = current.extensions[id];
      if (!record) throw new Error(`Managed extension not found: ${id}`);
      const revision = record.revisions.find(
        (candidate) => candidate.contentRevision === contentRevision,
      );
      if (!revision || revision.state !== 'installed') {
        throw new Error(`Managed extension revision is unavailable: ${id}/${contentRevision}`);
      }
      return {
        ...current,
        extensions: {
          ...current.extensions,
          [id]: { ...record, selectedRevision: contentRevision },
        },
      };
    });
  }

  async markLastKnownGood(
    extensionId: string,
    contentRevision: string,
  ): Promise<ExtensionRegistryDocument> {
    const id = normalizeResourceId(extensionId);
    return this.mutate((current) => {
      const record = current.extensions[id];
      if (!record) throw new Error(`Managed extension not found: ${id}`);
      const revision = record.revisions.find(
        (candidate) => candidate.contentRevision === contentRevision,
      );
      if (!revision || revision.state !== 'installed') {
        throw new Error(`Managed extension revision is unavailable: ${id}/${contentRevision}`);
      }
      return {
        ...current,
        extensions: {
          ...current.extensions,
          [id]: {
            ...record,
            selectedRevision: contentRevision,
            lastKnownGoodRevision: contentRevision,
          },
        },
      };
    });
  }

  async quarantine(
    extensionId: string,
    contentRevision: string,
  ): Promise<ExtensionRegistryDocument> {
    const id = normalizeResourceId(extensionId);
    return this.mutate((current) => {
      const record = current.extensions[id];
      if (!record) throw new Error(`Managed extension not found: ${id}`);
      const found = record.revisions.some(
        (revision) => revision.contentRevision === contentRevision,
      );
      if (!found) throw new Error(`Managed extension revision not found: ${id}/${contentRevision}`);
      const nextSelected =
        record.selectedRevision === contentRevision
          ? record.lastKnownGoodRevision
          : record.selectedRevision;
      return {
        ...current,
        extensions: {
          ...current.extensions,
          [id]: {
            ...record,
            configuredEnabled:
              record.selectedRevision === contentRevision ? false : record.configuredEnabled,
            ...(nextSelected ? { selectedRevision: nextSelected } : {}),
            revisions: record.revisions.map((revision) =>
              revision.contentRevision === contentRevision
                ? { ...revision, state: 'quarantined' as const }
                : { ...revision },
            ),
          },
        },
      };
    });
  }

  async listActiveRevisionRefs(): Promise<ExtensionRevisionRef[]> {
    const records = await this.listRecords();
    const refs: ExtensionRevisionRef[] = [];
    for (const record of records) {
      if (!record.configuredEnabled || !record.selectedRevision) continue;
      const revision = record.revisions.find(
        (candidate) =>
          candidate.contentRevision === record.selectedRevision && candidate.state === 'installed',
      );
      if (revision) {
        refs.push({
          extensionId: revision.extensionId,
          contentRevision: revision.contentRevision,
          entryPath: revision.entryPath,
        });
      }
    }
    return refs.sort((left, right) => left.extensionId.localeCompare(right.extensionId));
  }

  private async materializeRevision(input: {
    sourcePath: string;
    kind: 'file' | 'directory';
    revisionDirectory: string;
    extensionId: string;
    contentRevision: string;
    version?: string;
    sourceLocator?: string;
  }): Promise<void> {
    try {
      if ((await stat(input.revisionDirectory)).isDirectory()) {
        return;
      }
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }

    const extensionParent = dirname(input.revisionDirectory);
    await mkdir(extensionParent, { recursive: true });
    const stagingDirectory = await mkdtemp(join(extensionParent, '.staging-'));
    try {
      const stagingSource = join(stagingDirectory, SOURCE_DIRECTORY);
      await mkdir(stagingSource, { recursive: true });
      if (input.kind === 'file') {
        await copyFile(input.sourcePath, join(stagingSource, basename(input.sourcePath)));
      } else {
        await cp(input.sourcePath, stagingSource, {
          recursive: true,
          force: false,
          errorOnExist: false,
        });
      }
      const manifest = {
        version: 1,
        extensionId: input.extensionId,
        contentRevision: input.contentRevision,
        entryPath: relative(
          stagingDirectory,
          input.kind === 'file' ? join(stagingSource, basename(input.sourcePath)) : stagingSource,
        ),
        ...(input.version ? { versionName: input.version } : {}),
        ...(input.sourceLocator ? { sourceLocator: input.sourceLocator } : {}),
      };
      await writeFile(
        join(stagingDirectory, 'normalized-manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
        { encoding: 'utf8', mode: 0o600 },
      );
      await rename(stagingDirectory, input.revisionDirectory);
    } catch (error) {
      await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
      if (isAlreadyExists(error)) {
        return;
      }
      throw error;
    }
  }

  private mutate(
    update: (current: ExtensionRegistryDocument) => ExtensionRegistryDocument,
  ): Promise<ExtensionRegistryDocument> {
    const result = this.mutationChain.then(
      () => this.applyMutation(update),
      () => this.applyMutation(update),
    );
    // A failed mutation must never wedge the chain; later writes still run.
    this.mutationChain = result.catch(() => undefined);
    return result;
  }

  private async applyMutation(
    update: (current: ExtensionRegistryDocument) => ExtensionRegistryDocument,
  ): Promise<ExtensionRegistryDocument> {
    const current = await this.readRegistry();
    const next = update(current);
    const document: ExtensionRegistryDocument = {
      version: REGISTRY_VERSION,
      revision: computeRegistryRevision(next.extensions),
      extensions: next.extensions,
    };
    await mkdir(this.extensionsDir, { recursive: true });
    const temporaryPath = join(this.extensionsDir, `.${REGISTRY_FILENAME}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporaryPath, this.registryPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
    return document;
  }

  private deploymentPath(deploymentId: string): string {
    assertSafeIdentifier(deploymentId, 'deployment id');
    return join(this.deploymentsDir, `${deploymentId}.json`);
  }
}

export function createExtensionRevisionStore(piwinRoot: string): ExtensionRevisionStore {
  return new ExtensionRevisionStore({ piwinRoot });
}

function createEmptyRegistry(): ExtensionRegistryDocument {
  return {
    version: REGISTRY_VERSION,
    revision: computeRegistryRevision({}),
    extensions: {},
  };
}

function parseRegistry(value: unknown): ExtensionRegistryDocument {
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

function parseRecord(id: string, value: unknown): InstalledExtensionRecord {
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
  };
}

function parseRevision(extensionId: string, value: unknown): ManagedExtensionRevision {
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

function parseDeployment(value: unknown): ExtensionDeploymentRecord {
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

async function inspectSource(sourcePath: string): Promise<{
  kind: 'file' | 'directory';
  defaultName: string;
  version?: string;
  description: string;
}> {
  const sourceStat = await lstat(sourcePath);
  if (sourceStat.isSymbolicLink())
    throw new Error(`Extension source cannot be a symbolic link: ${sourcePath}`);
  if (sourceStat.isFile()) {
    if (extname(sourcePath).toLowerCase() !== '.ts' || sourcePath.endsWith('.d.ts')) {
      throw new Error(`Extension file must be a .ts module: ${sourcePath}`);
    }
    const raw = await readFile(sourcePath, 'utf8');
    return {
      kind: 'file',
      defaultName: basename(sourcePath).replace(/\.ts$/i, ''),
      description: readDescription(raw),
    };
  }
  if (!sourceStat.isDirectory())
    throw new Error(`Extension source must be a file or directory: ${sourcePath}`);
  const indexPath = join(sourcePath, 'index.ts');
  try {
    await access(indexPath);
  } catch {
    throw new Error(`Extension directory must contain index.ts: ${sourcePath}`);
  }
  const packageMetadata = await readPackageMetadata(sourcePath);
  const raw = await readFile(indexPath, 'utf8');
  return {
    kind: 'directory',
    defaultName: packageMetadata.name ?? basename(sourcePath),
    ...(packageMetadata.version ? { version: packageMetadata.version } : {}),
    description: packageMetadata.description ?? readDescription(raw),
  };
}

async function readPackageMetadata(sourcePath: string): Promise<{
  name?: string;
  version?: string;
  description?: string;
}> {
  try {
    const raw = await readFile(join(sourcePath, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return {};
    return {
      ...(typeof parsed.name === 'string' ? { name: parsed.name } : {}),
      ...(typeof parsed.version === 'string' ? { version: parsed.version } : {}),
      ...(typeof parsed.description === 'string' ? { description: parsed.description } : {}),
    };
  } catch {
    return {};
  }
}

async function collectSourceFiles(
  sourcePath: string,
  kind: 'file' | 'directory',
): Promise<Array<{ relativePath: string; bytes: Buffer }>> {
  if (kind === 'file') {
    return [{ relativePath: basename(sourcePath), bytes: await readFile(sourcePath) }];
  }
  const files: Array<{ relativePath: string; bytes: Buffer }> = [];
  await visitDirectory(sourcePath, sourcePath, files);
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function visitDirectory(
  rootPath: string,
  currentPath: string,
  files: Array<{ relativePath: string; bytes: Buffer }>,
): Promise<void> {
  const entries = await readdir(currentPath, { withFileTypes: true });
  for (const entry of entries) {
    const pathValue = join(currentPath, entry.name);
    const entryStat = await lstat(pathValue);
    if (entryStat.isSymbolicLink()) {
      throw new Error(`Extension source cannot contain symbolic links: ${pathValue}`);
    }
    if (entry.isDirectory()) {
      await visitDirectory(rootPath, pathValue, files);
    } else if (entry.isFile()) {
      files.push({
        relativePath: relative(rootPath, pathValue).replaceAll('\\', '/'),
        bytes: await readFile(pathValue),
      });
    }
  }
}

function hashSourceFiles(files: readonly { relativePath: string; bytes: Buffer }[]): string {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update('\0');
    hash.update(file.bytes);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function computeRegistryRevision(extensions: Record<string, InstalledExtensionRecord>): string {
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

function latestInstalledRevision(
  record: InstalledExtensionRecord,
): ManagedExtensionRevision | undefined {
  return [...record.revisions]
    .filter((revision) => revision.state === 'installed')
    .sort((left, right) => right.installedAt.localeCompare(left.installedAt))[0];
}

function cloneRecord(record: InstalledExtensionRecord): InstalledExtensionRecord {
  return {
    ...record,
    ...(record.selectedRevision ? { selectedRevision: record.selectedRevision } : {}),
    ...(record.lastKnownGoodRevision
      ? { lastKnownGoodRevision: record.lastKnownGoodRevision }
      : {}),
    revisions: record.revisions.map((revision) => ({ ...revision })),
  };
}

function readDescription(raw: string): string {
  const start = raw.indexOf('/**');
  const end = start === -1 ? -1 : raw.indexOf('*/', start + 3);
  if (start !== -1 && end !== -1) {
    const line = raw
      .slice(start + 3, end)
      .split('\n')
      .map((value) => value.trim().replace(/^\*\s?/, ''))
      .find((value) => value.length > 0 && !value.startsWith('@'));
    if (line) return line;
  }
  return '(extension)';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertSafeIdentifier(value: string, label: string): void {
  if (
    value.length === 0 ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('\0')
  ) {
    throw new Error(`Invalid ${label}`);
  }
}

function isExtensionDeploymentPhase(value: unknown): value is ExtensionDeploymentPhase {
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

function isMissingFile(error: unknown): boolean {
  return isNodeError(error, 'ENOENT');
}

function isAlreadyExists(error: unknown): boolean {
  return isNodeError(error, 'EEXIST');
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}
