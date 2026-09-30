/** Declarative optional Agent plugins. No scripts, shell commands or JS modules. */
export type AgentPluginManifest = {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  minHostVersion: '0.0.0';
  protocol: 'acp';
  recipe: 'grok-stdio-v1';
  platforms: readonly ('darwin' | 'win32' | 'linux')[];
  verifiedCliVersions: readonly string[];
  helpUrl: string;
};

export type AgentPluginSource =
  | { kind: 'bundled'; agentId: 'grok' }
  | { kind: 'registry'; agentId: string; version: string; url: string; sha256: string };

export type AgentPluginInstallation = {
  agentId: string;
  manifest: AgentPluginManifest;
  /** Digest binds this installed declarative revision, not the CLI binary. */
  revision: string;
  enabled: boolean;
  source: AgentPluginSource;
  installedAt: string;
  /** User-owned dependency: never removed or upgraded during plugin uninstall. */
  runtime: { ownership: 'user'; binaryPath?: string };
};

export type AgentPluginHostCommand =
  | { id?: string; type: 'agents/list' }
  | { id?: string; type: 'agents/install'; source: AgentPluginSource }
  | { id?: string; type: 'agents/set-enabled'; agentId: string; enabled: boolean }
  | { id?: string; type: 'agents/uninstall'; agentId: string }
  | { id?: string; type: 'agents/select-runtime'; agentId: string; binaryPath: string };
