import { createHash } from 'node:crypto';
import { parseExecutableAgentPluginManifest, parseLegacyAgentPluginManifest, type AgentPluginManifest } from '@piwin/contracts';

export class AgentPluginError extends Error {
  override readonly name = 'AgentPluginError';
}

/** v1 stays readable. v2 is the only manifest that can name an artifact. Neither parser launches code. */
export function parseAgentPluginManifest(value: unknown): AgentPluginManifest {
  const manifest = parseExecutableAgentPluginManifest(value) ?? parseLegacyAgentPluginManifest(value);
  if (manifest === undefined) throw new AgentPluginError('agent-manifest-invalid: unsupported schema, agent or recipe');
  return manifest;
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
