/** Plugin system contracts — declarative composition of skills + MCP + secrets. */

import type { InstallSource, McpServerConfig } from './mcp.js';

/**
 * MCP server config as declared inside a plugin manifest. Identical to
 * {@link McpServerConfig} but `env` values may contain `${SECRET_NAME}`
 * placeholders that are resolved against the plugin's collected secrets at
 * install time. Raw secret values never appear in the persisted manifest.
 */
export type PluginMcpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
  restartOnCrash?: boolean;
};

/**
 * A secret that a plugin needs at install time. Piwin prompts the user,
 * stores the value in the keychain, and resolves `${name}` placeholders in
 * MCP env at runtime.
 */
export type PluginSecretDecl = {
  /** Env-var-safe name, used in `${name}` placeholders. Must match ^[A-Z0-9_]+$. */
  name: string;
  displayName?: string;
  description?: string;
  required?: boolean;
  /** Default env var to read from if the user does not provide a value. */
  defaultEnv?: string;
};

/**
 * The plugin manifest — `plugin.json` at the plugin root.
 * All paths in `skills` are relative to the plugin directory.
 */
export type PluginManifest = {
  /** Stable id, lowercase kebab, ^[a-z0-9-]+$. */
  id: string;
  /** Semver-ish version string. */
  version: string;
  name: string;
  description?: string;
  /** Relative paths to skill directories (each must contain SKILL.md). */
  skills?: string[];
  /** MCP servers to install, keyed by server id (^[a-zA-Z0-9_-]+$). */
  mcpServers?: Record<string, PluginMcpServerConfig>;
  /** Secrets to collect at install time. */
  secrets?: PluginSecretDecl[];
};

/**
 * Install source for a plugin. Extends {@link InstallSource} with a
 * `registry` kind that references an entry in a remote plugin registry,
 * and a `bundled` kind for first-party marketplace plugins shipped with
 * the Host (Cloudflare, GitHub, …).
 */
export type PluginInstallSource =
  | InstallSource
  | { kind: 'registry'; registryId: string; ref?: string }
  | { kind: 'bundled'; bundledId: string };

/** A single entry in a remote plugin registry index. */
export type PluginRegistryEntry = {
  id: string;
  name: string;
  description?: string;
  version: string;
  source: InstallSource;
};

/** The remote `plugins.json` index document. */
export type PluginRegistryIndex = {
  version: number;
  plugins: PluginRegistryEntry[];
};

/**
 * Persisted record of an installed plugin. Stored in
 * `~/.piwin/plugins/installed.json`. Tracks everything the plugin owns so
 * uninstall can cleanly reverse the installation.
 */
export type InstalledPlugin = {
  id: string;
  version: string;
  name: string;
  installedAt: string;
  source: PluginInstallSource;
  /** Skill ids installed by this plugin (under ~/.piwin/skills/). */
  skills: string[];
  /** Namespaced MCP server ids (plugin__<id>__<serverId>). */
  mcpServerIds: string[];
  /** Secret names collected for this plugin (keychain refs derived from these). */
  secrets: string[];
  /** Path to the materialized plugin directory under ~/.piwin/plugins/cache/. */
  manifestPath: string;
};

/** Result of installing a plugin. */
export type InstallPluginResult = {
  pluginId: string;
  installedSkills: string[];
  mcpServerIds: string[];
  secretRefs: string[];
};

/** Namespaced MCP server id: `plugin__<pluginId>__<serverId>`. */
export function pluginMcpServerId(pluginId: string, serverId: string): string {
  return `plugin__${pluginId}__${serverId}`;
}

/** Extract the raw server id from a namespaced plugin MCP server id. */
export function parsePluginMcpServerId(namespaced: string): {
  pluginId: string;
  serverId: string;
} | null {
  const match = /^plugin__([a-z0-9-]+)__(.+)$/.exec(namespaced);
  if (!match || match[1] === undefined || match[2] === undefined) return null;
  return { pluginId: match[1], serverId: match[2] };
}

/** Keychain ref for a plugin secret: `keychain:piwin-plugin-<pluginId>-<secretName>`. */
export function pluginSecretRef(pluginId: string, secretName: string): string {
  return `keychain:piwin-plugin-${pluginId}-${secretName}`;
}
