/**
 * Installed-plugin state store: `~/.piwin/plugins/installed.json`.
 * Source of truth for what plugins are installed and what they own,
 * so uninstall can cleanly reverse an installation.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { InstalledPlugin } from '@piwin/contracts';

export function getPluginsDir(piwinRoot: string): string {
  return join(piwinRoot, 'plugins');
}

export function getInstalledPluginsPath(piwinRoot: string): string {
  return join(getPluginsDir(piwinRoot), 'installed.json');
}

export async function loadInstalledPlugins(piwinRoot: string): Promise<InstalledPlugin[]> {
  const path = getInstalledPluginsPath(piwinRoot);
  try {
    const raw = await readFile(path, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is InstalledPlugin => {
      if (!entry || typeof entry !== 'object') return false;
      const record = entry as Record<string, unknown>;
      return (
        typeof record.id === 'string' &&
        typeof record.version === 'string' &&
        typeof record.name === 'string' &&
        typeof record.installedAt === 'string' &&
        typeof record.manifestPath === 'string' &&
        Array.isArray(record.skills) &&
        Array.isArray(record.mcpServerIds) &&
        Array.isArray(record.secrets)
      );
    });
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
}

export async function saveInstalledPlugins(
  piwinRoot: string,
  plugins: InstalledPlugin[],
): Promise<void> {
  const path = getInstalledPluginsPath(piwinRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(plugins, null, 2)}\n`, 'utf8');
}

/** Insert or replace a plugin record by id. */
export async function upsertInstalledPlugin(
  piwinRoot: string,
  plugin: InstalledPlugin,
): Promise<void> {
  const plugins = await loadInstalledPlugins(piwinRoot);
  const index = plugins.findIndex((entry) => entry.id === plugin.id);
  if (index >= 0) {
    plugins[index] = plugin;
  } else {
    plugins.push(plugin);
  }
  await saveInstalledPlugins(piwinRoot, plugins);
}

/** Remove a plugin record by id; returns the removed entry or null. */
export async function removeInstalledPlugin(
  piwinRoot: string,
  pluginId: string,
): Promise<InstalledPlugin | null> {
  const plugins = await loadInstalledPlugins(piwinRoot);
  const index = plugins.findIndex((entry) => entry.id === pluginId);
  if (index < 0) {
    return null;
  }
  const [removed] = plugins.splice(index, 1);
  await saveInstalledPlugins(piwinRoot, plugins);
  return removed ?? null;
}

export async function findInstalledPlugin(
  piwinRoot: string,
  pluginId: string,
): Promise<InstalledPlugin | undefined> {
  const plugins = await loadInstalledPlugins(piwinRoot);
  return plugins.find((entry) => entry.id === pluginId);
}

/** Remove the entire plugins directory (cache + installed.json). Used by tests. */
export async function clearPluginStore(piwinRoot: string): Promise<void> {
  try {
    await rm(getPluginsDir(piwinRoot), { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'ENOENT'
  );
}
