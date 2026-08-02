/**
 * Fetch + validate a remote plugin registry index (`plugins.json`).
 * Lightweight: no backend service, just a JSON document over HTTP or git.
 */
import type { InstallSource, PluginRegistryEntry, PluginRegistryIndex } from '@piwin/contracts';

export const DEFAULT_PLUGIN_REGISTRY_URL =
  'https://raw.githubusercontent.com/piwin/plugins/main/plugins.json';

export type FetchOptions = {
  /** Injected fetch for tests. Defaults to global fetch. */
  fetch?: (url: string) => Promise<Response>;
};

export async function fetchPluginRegistry(
  url: string,
  options?: FetchOptions,
): Promise<PluginRegistryIndex> {
  const fetchFn = options?.fetch ?? fetch;
  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(`Registry fetch failed: ${response.status} ${response.statusText}`);
  }
  const raw: unknown = await response.json();
  return validatePluginRegistry(raw);
}

export function validatePluginRegistry(raw: unknown): PluginRegistryIndex {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Registry index must be an object');
  }
  const record = raw as Record<string, unknown>;

  if (typeof record.version !== 'number' || record.version !== 1) {
    throw new Error('Registry index version must be 1');
  }

  if (!Array.isArray(record.plugins)) {
    throw new Error('Registry index "plugins" must be an array');
  }

  const plugins: PluginRegistryEntry[] = [];
  for (let i = 0; i < record.plugins.length; i++) {
    const entry = record.plugins[i];
    const validated = validateRegistryEntry(entry, `plugins[${i}]`);
    if (validated) {
      plugins.push(validated);
    }
  }

  return { version: 1, plugins };
}

function validateRegistryEntry(value: unknown, path: string): PluginRegistryEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path}: entry must be an object`);
  }
  const record = value as Record<string, unknown>;

  if (typeof record.id !== 'string' || !record.id.trim()) {
    throw new Error(`${path}.id: must be a non-empty string`);
  }
  if (typeof record.name !== 'string' || !record.name.trim()) {
    throw new Error(`${path}.name: must be a non-empty string`);
  }
  if (typeof record.version !== 'string' || !record.version.trim()) {
    throw new Error(`${path}.version: must be a non-empty string`);
  }

  const source = validateInstallSource(record.source, `${path}.source`);
  if (!source) {
    throw new Error(`${path}.source: invalid install source`);
  }

  const entry: PluginRegistryEntry = {
    id: record.id,
    name: record.name,
    version: record.version,
    source,
  };
  if (typeof record.description === 'string') {
    entry.description = record.description;
  }
  return entry;
}

function validateInstallSource(value: unknown, path: string): InstallSource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.kind === 'local' && typeof record.path === 'string') {
    return { kind: 'local', path: record.path };
  }
  if (record.kind === 'git' && typeof record.url === 'string') {
    const source: InstallSource = { kind: 'git', url: record.url };
    if (typeof record.ref === 'string') {
      source.ref = record.ref;
    }
    if (typeof record.subdir === 'string') {
      source.subdir = record.subdir;
    }
    return source;
  }
  return null;
}
