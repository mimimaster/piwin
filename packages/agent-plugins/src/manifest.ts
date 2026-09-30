import { createHash } from 'node:crypto';
import type { AgentPluginManifest } from '@piwin/contracts';

export class AgentPluginError extends Error {
  override readonly name = 'AgentPluginError';
}

const KEYS = new Set(['schemaVersion', 'id', 'name', 'version', 'minHostVersion', 'protocol', 'recipe', 'platforms', 'verifiedCliVersions', 'helpUrl']);
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

/** Only reviewed recipes can execute; a catalog cannot introduce new code. */
export function parseAgentPluginManifest(value: unknown): AgentPluginManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AgentPluginError('agent-manifest-invalid: expected an object');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !KEYS.has(key)) || record.schemaVersion !== 1 ||
      record.id !== 'grok' || record.minHostVersion !== '0.0.0' || record.recipe !== 'grok-stdio-v1' || record.protocol !== 'acp' ||
      typeof record.name !== 'string' || !record.name.trim() || record.name.length > 120 ||
      typeof record.version !== 'string' || !EXACT_VERSION.test(record.version) ||
      typeof record.helpUrl !== 'string' || !record.helpUrl.startsWith('https://') ||
      !Array.isArray(record.platforms) || record.platforms.length === 0 ||
      !record.platforms.every((platform) => platform === 'darwin' || platform === 'win32' || platform === 'linux') ||
      !Array.isArray(record.verifiedCliVersions) ||
      !record.verifiedCliVersions.every((version) => typeof version === 'string' && EXACT_VERSION.test(version))) {
    throw new AgentPluginError('agent-manifest-invalid: unsupported schema, agent or recipe');
  }
  return {
    schemaVersion: 1, id: 'grok', name: record.name, version: record.version, minHostVersion: '0.0.0',
    protocol: 'acp', recipe: 'grok-stdio-v1',
    platforms: record.platforms as AgentPluginManifest['platforms'],
    verifiedCliVersions: record.verifiedCliVersions as string[], helpUrl: record.helpUrl,
  };
}

/** Canonical declared field order makes revisions independent of JSON key order. */
export function agentManifestRevision(manifest: AgentPluginManifest): string {
  return createHash('sha256').update(JSON.stringify(parseAgentPluginManifest(manifest))).digest('hex');
}

export const GROK_PLUGIN_MANIFEST: AgentPluginManifest = {
  schemaVersion: 1, id: 'grok', name: 'Grok Build', version: '1.0.0', minHostVersion: '0.0.0', protocol: 'acp',
  recipe: 'grok-stdio-v1', platforms: ['darwin'],
  verifiedCliVersions: ['1.0.41', '1.0.44'], helpUrl: 'https://grok.com',
};
