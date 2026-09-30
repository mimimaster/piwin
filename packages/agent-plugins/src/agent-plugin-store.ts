import type { AgentPluginInstallation, AgentPluginManifest, AgentPluginSource } from '@piwin/contracts';
import { AgentPluginError, agentManifestRevision, parseAgentPluginManifest } from './manifest.js';

/** Host injects atomic, serialized persistence; this package never spawns a CLI. */
export type AgentPluginStorePort = {
  read: () => Promise<unknown>;
  mutate: <Result>(operation: (current: unknown) => { document: unknown; result: Result }) => Promise<Result>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseAgentPluginInstallations(document: unknown): AgentPluginInstallation[] {
  if (document === undefined) return [];
  if (!isObject(document) || document.schemaVersion !== 1 || !Array.isArray(document.plugins)) {
    throw new AgentPluginError('agent-inventory-invalid');
  }
  const seen = new Set<string>();
  return document.plugins.map((raw: unknown) => {
    if (!isObject(raw) || typeof raw.enabled !== 'boolean' || typeof raw.installedAt !== 'string' ||
        !isObject(raw.runtime) || raw.runtime.ownership !== 'user' ||
        (raw.runtime.binaryPath !== undefined && typeof raw.runtime.binaryPath !== 'string') ||
        !isObject(raw.source)) throw new AgentPluginError('agent-inventory-invalid');
    const manifest = parseAgentPluginManifest(raw.manifest);
    if (raw.agentId !== manifest.id || raw.revision !== agentManifestRevision(manifest) || seen.has(manifest.id)) {
      throw new AgentPluginError('agent-inventory-invalid: identity or revision mismatch');
    }
    seen.add(manifest.id);
    const source = parseAgentPluginSource(raw.source);
    return {
      agentId: manifest.id, manifest, revision: agentManifestRevision(manifest), enabled: raw.enabled,
      installedAt: raw.installedAt, source,
      runtime: { ownership: 'user', ...(typeof raw.runtime.binaryPath === 'string' ? { binaryPath: raw.runtime.binaryPath } : {}) },
    };
  });
}

export function parseAgentPluginSource(value: unknown): AgentPluginSource {
  if (isObject(value) && value.kind === 'bundled' && value.agentId === 'grok') {
    return { kind: 'bundled', agentId: 'grok' };
  }
  if (isObject(value) && value.kind === 'registry' && value.agentId === 'grok' &&
      typeof value.version === 'string' && /^\d+\.\d+\.\d+$/.test(value.version) && typeof value.url === 'string' &&
      typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256)) {
    const url = new URL(value.url);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.hash) {
      return { kind: 'registry', agentId: value.agentId, version: value.version, url: url.href, sha256: value.sha256 };
    }
  }
  throw new AgentPluginError('agent-source-invalid: require a pinned HTTPS manifest or reviewed bundled adapter');
}

export class AgentPluginStore {
  constructor(private readonly port: AgentPluginStorePort) {}

  async list(): Promise<AgentPluginInstallation[]> {
    return parseAgentPluginInstallations(await this.port.read());
  }

  async get(agentId: string): Promise<AgentPluginInstallation | undefined> {
    return (await this.list()).find((plugin) => plugin.agentId === agentId);
  }

  install(input: { manifest: AgentPluginManifest; source: AgentPluginSource; platform: string }): Promise<AgentPluginInstallation> {
    const manifest = parseAgentPluginManifest(input.manifest);
    const source = parseAgentPluginSource(input.source);
    if (!manifest.platforms.some((platform) => platform === input.platform) || input.platform !== 'darwin') {
      throw new AgentPluginError('agent-platform-unverified: no verified Grok recipe for this Host');
    }
    return this.change((plugins) => {
      const existing = plugins.find((plugin) => plugin.agentId === manifest.id);
      const revision = agentManifestRevision(manifest);
      if (existing !== undefined && existing.revision !== revision) {
        throw new AgentPluginError('agent-update-requires-migration: installed revision must not be replaced silently');
      }
      if (existing !== undefined) return { plugins, result: existing };
      const installed: AgentPluginInstallation = {
        agentId: manifest.id, manifest, revision, enabled: true, source,
        installedAt: new Date().toISOString(), runtime: { ownership: 'user' },
      };
      return { plugins: [...plugins, installed], result: installed };
    });
  }

  setEnabled(agentId: string, enabled: boolean): Promise<AgentPluginInstallation> {
    if (typeof enabled !== 'boolean') throw new AgentPluginError('agent-enabled-invalid');
    return this.update(agentId, (plugin) => ({ ...plugin, enabled }));
  }

  selectRuntime(agentId: string, binaryPath: string): Promise<AgentPluginInstallation> {
    if (typeof binaryPath !== 'string' || !binaryPath.trim() || binaryPath.includes('\0') || !binaryPath.startsWith('/')) {
      throw new AgentPluginError('agent-runtime-path-invalid: expected an absolute Host path');
    }
    return this.update(agentId, (plugin) => ({ ...plugin, runtime: { ownership: 'user', binaryPath } }));
  }

  /** Removes only our adapter record. No session, auth or runtime deletion port exists. */
  uninstall(agentId: string): Promise<void> {
    if (agentId !== 'grok') throw new AgentPluginError('unknown-agent');
    return this.change((plugins) => ({ plugins: plugins.filter((plugin) => plugin.agentId !== agentId), result: undefined }));
  }

  private update(agentId: string, operation: (plugin: AgentPluginInstallation) => AgentPluginInstallation): Promise<AgentPluginInstallation> {
    return this.change((plugins) => {
      const existing = plugins.find((plugin) => plugin.agentId === agentId);
      if (existing === undefined) throw new AgentPluginError('agent-plugin-not-installed');
      const updated = operation(existing);
      return { plugins: plugins.map((plugin) => plugin.agentId === agentId ? updated : plugin), result: updated };
    });
  }

  private change<Result>(operation: (plugins: AgentPluginInstallation[]) => { plugins: AgentPluginInstallation[]; result: Result }): Promise<Result> {
    return this.port.mutate((current) => {
      const changed = operation(parseAgentPluginInstallations(current));
      const document = { schemaVersion: 1, plugins: changed.plugins };
      parseAgentPluginInstallations(document);
      return { document, result: changed.result };
    });
  }
}
