/**
 * Adapt a Codex plugin manifest into piwin's PluginManifest format.
 *
 * Codex plugins may declare `connectors`, `hooks`, `apps`, `drivers` —
 * piwin does not replicate these. They are dropped with a warning.
 * Skills, MCP servers, and secret/env declarations are mapped.
 */
import type {
  PluginManifest,
  PluginMcpServerConfig,
  PluginSecretDecl,
} from '@piwin/contracts';

export type CodexAdaptResult = {
  manifest: PluginManifest;
  warnings: string[];
};

/** Keys that Codex uses but piwin drops. */
const DROPPED_KEYS = ['connectors', 'hooks', 'apps', 'drivers', 'permissions'];

export function adaptCodexManifest(raw: unknown): CodexAdaptResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Codex manifest must be an object');
  }
  const record = raw as Record<string, unknown>;
  const warnings: string[] = [];

  for (const key of DROPPED_KEYS) {
    if (key in record) {
      warnings.push(`Dropped Codex-only key "${key}" (not supported by piwin)`);
    }
  }

  // id / version / name — Codex uses the same field names.
  const id = typeof record.id === 'string' ? record.id.toLowerCase() : '';
  const version = typeof record.version === 'string' ? record.version : '';
  const name = typeof record.name === 'string' ? record.name : '';

  if (!id || !version || !name) {
    throw new Error(
      'Codex manifest missing required fields (id, version, or name)',
    );
  }

  const manifest: PluginManifest = { id, version, name };

  // description
  if (typeof record.description === 'string') {
    manifest.description = record.description;
  }

  // skills — Codex uses the same shape (array of relative paths).
  if (Array.isArray(record.skills)) {
    manifest.skills = record.skills.filter(
      (s): s is string => typeof s === 'string',
    );
  }

  // mcpServers — shape is compatible (command, args, env).
  if (record.mcpServers && typeof record.mcpServers === 'object' && !Array.isArray(record.mcpServers)) {
    const servers = record.mcpServers as Record<string, unknown>;
    const adapted: Record<string, PluginMcpServerConfig> = {};
    for (const [serverId, serverValue] of Object.entries(servers)) {
      if (!serverValue || typeof serverValue !== 'object' || Array.isArray(serverValue)) {
        warnings.push(`Skipped invalid MCP server "${serverId}"`);
        continue;
      }
      const srv = serverValue as Record<string, unknown>;
      if (typeof srv.command !== 'string') {
        warnings.push(`Skipped MCP server "${serverId}" (missing command)`);
        continue;
      }
      const config: PluginMcpServerConfig = { command: srv.command };
      if (Array.isArray(srv.args)) {
        config.args = srv.args.filter((a): a is string => typeof a === 'string');
      }
      if (srv.env && typeof srv.env === 'object' && !Array.isArray(srv.env)) {
        const env: Record<string, string> = {};
        for (const [k, v] of Object.entries(srv.env)) {
          if (typeof v === 'string') {
            env[k] = v;
          }
        }
        if (Object.keys(env).length > 0) {
          config.env = env;
        }
      }
      adapted[serverId] = config;
    }
    if (Object.keys(adapted).length > 0) {
      manifest.mcpServers = adapted;
    }
  }

  // secrets / env declarations — Codex may use "secrets" or "env" arrays.
  const secretDecls: PluginSecretDecl[] = [];
  for (const field of ['secrets', 'env'] as const) {
    if (Array.isArray(record[field])) {
      for (const entry of record[field]) {
        const decl = adaptSecretDecl(entry);
        if (decl) {
          secretDecls.push(decl);
        }
      }
    }
  }
  if (secretDecls.length > 0) {
    manifest.secrets = secretDecls;
  }

  return { manifest, warnings };
}

function adaptSecretDecl(value: unknown): PluginSecretDecl | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;

  // Codex may use "name" or "key" for the secret name.
  const name = typeof record.name === 'string'
    ? record.name
    : typeof record.key === 'string'
      ? record.key
      : null;
  if (!name) {
    return null;
  }

  const decl: PluginSecretDecl = { name: name.toUpperCase() };
  if (typeof record.displayName === 'string') {
    decl.displayName = record.displayName;
  }
  if (typeof record.description === 'string') {
    decl.description = record.description;
  }
  if (typeof record.required === 'boolean') {
    decl.required = record.required;
  }
  if (typeof record.defaultEnv === 'string') {
    decl.defaultEnv = record.defaultEnv;
  }
  return decl;
}
