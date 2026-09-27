/**
 * Parse the extension registry `index.json` (ADR 0077).
 *
 * The index is fetched from a third-party-writable repository, so it is
 * untrusted. A malformed document fails as a whole; a malformed entry is
 * dropped with a diagnostic so one bad entry cannot hide the others. Unknown
 * keys are ignored for forward compatibility — the registry CI is the strict
 * gate for entry files.
 */
import {
  EXTENSION_REGISTRY_COMMIT_PATTERN,
  EXTENSION_REGISTRY_OWNER_PATTERN,
  EXTENSION_REGISTRY_SCHEMA_VERSION,
  parseExtensionRegistryId,
  type ExtensionRegistryEntry,
  type ExtensionRegistryIndex,
  type ExtensionRegistryVersion,
} from '@piwin/contracts';

export type ParsedRegistryIndex = {
  index: ExtensionRegistryIndex;
  /** One line per dropped entry: `<position>: <reason>`. */
  diagnostics: string[];
};

const GITHUB_REPOSITORY_PATTERN = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_KEYWORDS = 20;

class RegistryEntryError extends Error {
  override readonly name = 'RegistryEntryError';
}

export function parseRegistryIndex(raw: unknown): ParsedRegistryIndex {
  const record = asRecord(raw);
  if (!record) throw new Error('registry index must be a JSON object');
  if (record.schemaVersion !== EXTENSION_REGISTRY_SCHEMA_VERSION) {
    throw new Error(
      `unsupported registry schemaVersion ${String(record.schemaVersion)}; expected ${EXTENSION_REGISTRY_SCHEMA_VERSION}`,
    );
  }
  if (!Array.isArray(record.extensions)) {
    throw new Error('registry index "extensions" must be an array');
  }
  const extensions: ExtensionRegistryEntry[] = [];
  const diagnostics: string[] = [];
  const seenIds = new Set<string>();
  record.extensions.forEach((value, position) => {
    try {
      const entry = parseEntry(value);
      if (seenIds.has(entry.id)) throw new RegistryEntryError(`duplicate id ${entry.id}`);
      seenIds.add(entry.id);
      extensions.push(entry);
    } catch (error) {
      if (!(error instanceof RegistryEntryError)) throw error;
      diagnostics.push(`extensions[${position}]: ${error.message}`);
    }
  });
  return {
    index: {
      schemaVersion: EXTENSION_REGISTRY_SCHEMA_VERSION,
      generatedAt: typeof record.generatedAt === 'string' ? record.generatedAt : '',
      extensions,
    },
    diagnostics,
  };
}

function parseEntry(value: unknown): ExtensionRegistryEntry {
  const record = asRecord(value);
  if (!record) throw new RegistryEntryError('entry must be an object');
  const id = typeof record.id === 'string' ? parseExtensionRegistryId(record.id) : null;
  if (!id) throw new RegistryEntryError('id must be "<owner>/<name>"');
  const entryId = `${id.owner}/${id.name}`;

  const entry: ExtensionRegistryEntry = {
    id: entryId,
    name: requireText(record.name, 'name', MAX_NAME_LENGTH),
    description:
      record.description === undefined
        ? ''
        : requireText(record.description, 'description', MAX_DESCRIPTION_LENGTH, true),
    owners: parseOwners(record.owners),
    repository: parseRepository(record.repository),
    license: requireText(record.license, 'license', 64),
    versions: parseVersions(record.versions),
  };
  if (record.subdir !== undefined) entry.subdir = parseSubdir(record.subdir);
  if (record.keywords !== undefined) entry.keywords = parseKeywords(record.keywords);
  if (record.homepage !== undefined) {
    if (typeof record.homepage !== 'string' || !/^https:\/\//.test(record.homepage)) {
      throw new RegistryEntryError('homepage must be an https URL');
    }
    entry.homepage = record.homepage;
  }
  if (record.forkOf !== undefined) {
    const fork = asRecord(record.forkOf);
    const baseId = fork && typeof fork.id === 'string' ? parseExtensionRegistryId(fork.id) : null;
    if (!fork || !baseId || typeof fork.version !== 'string' || !VERSION_PATTERN.test(fork.version)) {
      throw new RegistryEntryError('forkOf must be { id: "<owner>/<name>", version }');
    }
    const baseEntryId = `${baseId.owner}/${baseId.name}`;
    if (baseEntryId === entryId) throw new RegistryEntryError('forkOf cannot name the entry itself');
    entry.forkOf = { id: baseEntryId, version: fork.version };
  }
  return entry;
}

function parseOwners(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new RegistryEntryError('owners must be a non-empty array');
  }
  const owners = value.map((owner) => {
    const handle = typeof owner === 'string' ? owner.trim().toLowerCase() : '';
    if (!EXTENSION_REGISTRY_OWNER_PATTERN.test(handle)) {
      throw new RegistryEntryError(`invalid owner handle ${JSON.stringify(owner)}`);
    }
    return handle;
  });
  return [...new Set(owners)];
}

function parseRepository(value: unknown): string {
  const url = typeof value === 'string' ? value.trim().replace(/\.git$/i, '').replace(/\/+$/, '') : '';
  if (!GITHUB_REPOSITORY_PATTERN.test(url)) {
    throw new RegistryEntryError('repository must be https://github.com/<owner>/<repo>');
  }
  return url;
}

/** Relative POSIX path inside the repository; never escapes it. */
function parseSubdir(value: unknown): string {
  const subdir = typeof value === 'string' ? value.trim().replace(/^\.\/+/, '').replace(/\/+$/, '') : '';
  const invalid =
    !subdir ||
    subdir.startsWith('/') ||
    subdir.includes('\\') ||
    subdir.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
  if (invalid) throw new RegistryEntryError('subdir must be a relative path inside the repository');
  return subdir;
}

function parseKeywords(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_KEYWORDS) {
    throw new RegistryEntryError(`keywords must be an array of at most ${MAX_KEYWORDS} strings`);
  }
  return value.map((keyword) => requireText(keyword, 'keyword', 40).toLowerCase());
}

function parseVersions(value: unknown): ExtensionRegistryVersion[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new RegistryEntryError('versions must be a non-empty array');
  }
  const seen = new Set<string>();
  return value.map((item) => {
    const record = asRecord(item);
    if (!record) throw new RegistryEntryError('version must be an object');
    if (typeof record.version !== 'string' || !VERSION_PATTERN.test(record.version)) {
      throw new RegistryEntryError(`invalid version ${JSON.stringify(record.version)}`);
    }
    if (seen.has(record.version)) throw new RegistryEntryError(`duplicate version ${record.version}`);
    seen.add(record.version);
    const commit = typeof record.commit === 'string' ? record.commit.toLowerCase() : '';
    if (!EXTENSION_REGISTRY_COMMIT_PATTERN.test(commit)) {
      throw new RegistryEntryError(`version ${record.version}: commit must be a full 40-hex SHA`);
    }
    const version: ExtensionRegistryVersion = { version: record.version, commit };
    if (typeof record.publishedAt === 'string') version.publishedAt = record.publishedAt;
    if (record.yanked !== undefined) {
      const yanked = asRecord(record.yanked);
      version.yanked = {
        reason: yanked && typeof yanked.reason === 'string' ? yanked.reason : 'yanked',
      };
    }
    return version;
  });
}

function requireText(value: unknown, field: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string') throw new RegistryEntryError(`${field} must be a string`);
  const text = value.trim();
  if (!allowEmpty && !text) throw new RegistryEntryError(`${field} must not be empty`);
  if (text.length > maxLength) {
    throw new RegistryEntryError(`${field} exceeds ${maxLength} characters`);
  }
  return text;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
