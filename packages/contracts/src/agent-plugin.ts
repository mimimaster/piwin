/** Legacy declaration: readable for migration, never executable by the v2 loader. */
export type LegacyAgentPluginManifest = {
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

/** A reviewed single-file Node ESM adapter. No install scripts or dependency resolution. */
export type ExecutableAgentPluginManifest = {
  schemaVersion: 2;
  id: string;
  name: string;
  version: string;
  minHostVersion: string;
  protocol: 'piwin-agent-stdio';
  protocolVersion: 1;
  minHostProtocolVersion: number;
  platforms: readonly ('darwin' | 'win32' | 'linux')[];
  verifiedCliVersions: readonly string[];
  helpUrl: string;
  /** Immutable source commit used to build the artifact (not a branch or tag). */
  sourceRevision: string;
  artifact: {
    format: 'node-esm';
    entrypoint: 'agent.mjs';
    url: string;
    sha256: string;
    byteSize: number;
  };
  /** Compatibility is permission to offer migration, not permission to migrate silently. */
  compatibleRevisions: readonly string[];
  unversionedBindingCompatible: boolean;
  /** Host derives roots from this reviewed declaration, never from a process message. */
  outputDirectories: readonly AgentPluginOutputDirectory[];
};

export type AgentPluginOutputDirectory = {
  id: string;
  base: 'working-directory' | 'user-home';
  /** Safe relative segments. Only `{backendSessionId}` and `{encodedWorkingDirectory}` may be substituted. */
  relativePath: string;
  kind: 'image' | 'video';
};

export type AgentPluginManifest = LegacyAgentPluginManifest | ExecutableAgentPluginManifest;

export type AgentPluginSource =
  | { kind: 'bundled'; agentId: 'grok' }
  | { kind: 'registry'; agentId: string; version: string; url: string; sha256: string };

export type AgentPluginInstallation = {
  agentId: string;
  manifest: AgentPluginManifest;
  /** Digest binds the canonical complete manifest, including the executable digest; not the CLI. */
  revision: string;
  enabled: boolean;
  source: AgentPluginSource;
  installedAt: string;
  /** User-owned dependency: never removed or upgraded during plugin uninstall. */
  runtime: { ownership: 'user'; binaryPath?: string };
};

export type AgentPluginHostCommand =
  | { id?: string; type: 'agents/list' }
  | { id?: string; type: 'agents/install'; source: AgentPluginSource; confirmMigration?: boolean }
  | { id?: string; type: 'agents/set-enabled'; agentId: string; enabled: boolean }
  | { id?: string; type: 'agents/uninstall'; agentId: string }
  | { id?: string; type: 'agents/select-runtime'; agentId: string; binaryPath: string }
  | {
      id?: string;
      type: 'agents/confirm-binding-migration';
      sessionId: string;
      expectedRevision: string | null;
      targetRevision: string;
    };
