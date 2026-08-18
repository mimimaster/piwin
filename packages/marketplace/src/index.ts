export { installSkill } from './install-skill.js';
export type { InstallSkillOptions, InstallSkillResult } from './install-skill.js';
export { installExtension } from './install-extension.js';
export type { InstallExtensionOptions, InstallExtensionResult } from './install-extension.js';
export { RECOMMENDED_SKILLS } from './catalog.js';
export type { RecommendedSkill } from './catalog.js';

export {
  listStaticMcpRegistry,
  listMcpRegistryCards,
  draftToServerConfig,
  STATIC_MCP_REGISTRY,
} from './mcp-registry.js';
export { listSkillStoreEntries } from './skill-store.js';

// Plugin system
export { parsePluginManifest, tryValidatePluginManifest } from './plugin/manifest.js';
export type { ManifestIssue, ManifestValidationResult } from './plugin/manifest.js';
export { installPlugin } from './plugin/install-plugin.js';
export type { InstallPluginOptions } from './plugin/install-plugin.js';
export {
  resolveSecretEnv,
  resolveSecretArgs,
  resolveSecretText,
  extractSecretPlaceholders,
} from './plugin/secret-env.js';
export { FEATURED_PLUGINS, findFeaturedPlugin } from './plugin/featured-catalog.js';
export type { FeaturedPluginCategory, FeaturedPluginEntry, FeaturedPluginGitSource } from './plugin/featured-catalog.js';
export {
  loadInstalledPlugins,
  saveInstalledPlugins,
  upsertInstalledPlugin,
  removeInstalledPlugin,
  findInstalledPlugin,
  getInstalledPluginsPath,
  getPluginsDir,
  clearPluginStore,
} from './plugin/plugin-store.js';
export { adaptCodexManifest } from './plugin/codex-adapter.js';
export type { CodexAdaptResult } from './plugin/codex-adapter.js';
export {
  fetchPluginRegistry,
  validatePluginRegistry,
  DEFAULT_PLUGIN_REGISTRY_URL,
} from './plugin/registry.js';
export type { FetchOptions } from './plugin/registry.js';
