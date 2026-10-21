export { RECOMMENDED_SKILLS } from './skill-store.js';
export { DEFAULT_AGENT_REGISTRY_URL, parseAgentRegistryIndex, fetchAgentRegistryIndex } from './agent-registry-index.js';
export type { RecommendedSkill } from './skill-store.js';
export {
  MARKETPLACE_CATALOG,
  findCatalogEntry,
  listCatalogEntries,
  matchCatalogEntry,
  validateCatalogEntry,
} from './catalog/catalog.js';
export type { ListCatalogEntriesOptions } from './catalog/catalog.js';
export {
  isExactNpmVersion,
  isNpmPackageName,
  normalizeRepositoryUrl,
  npmPackagePageUrl,
  piInstallCommand,
  searchPiNpmPackages,
} from './search-pi-packages.js';
export type { SearchPiPackagesOptions } from './search-pi-packages.js';
export { piGitInstallCommand, searchPiGithubRepos } from './search-pi-github.js';
export type { SearchPiGithubOptions } from './search-pi-github.js';
export { EXCLUDED_COMMUNITY_RECOMMENDATIONS, searchMarketplaceSources } from './search-marketplace.js';
export {
  parseSkillsShEntryId,
  searchSkillsSh,
  skillInstallCommand,
  skillsShEntryId,
  skillsShInstallSource,
} from './search-skills-sh.js';
export type { SearchSkillsShOptions } from './search-skills-sh.js';
export { fetchPackageDetail, githubOwnerRepo, MAX_README_CHARS } from './package-detail.js';
export type { FetchPackageDetailOptions } from './package-detail.js';
export type { SearchMarketplaceOptions } from './search-marketplace.js';
export {
  DEFAULT_EXTENSION_REGISTRY_URL,
  fetchExtensionRegistryIndex,
  listMarketplaceWithExtensions,
  parseExtensionRegistryIndex,
} from './extension-registry-index.js';

export {
  listStaticMcpRegistry,
  listMcpRegistryCards,
  draftToServerConfig,
  STATIC_MCP_REGISTRY,
} from './mcp-registry.js';
export {
  OFFICIAL_MCP_REGISTRY_URL,
  OFFICIAL_MCP_SEARCH_TIMEOUT_MS,
  cardFromOfficialServer,
  clearOfficialMcpSearchCache,
  officialMcpServerId,
  parseOfficialRegistryServers,
  searchOfficialMcpRegistry,
} from './mcp-official-registry.js';
export type { SearchOfficialMcpRegistryOptions } from './mcp-official-registry.js';
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
export {
  FEATURED_PLUGINS,
  findFeaturedPlugin,
  listBundledPluginSummaries,
} from './plugin/featured-catalog.js';
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
