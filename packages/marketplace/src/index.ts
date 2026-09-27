export { RECOMMENDED_SKILLS } from './skill-store.js';
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
export { searchMarketplaceSources } from './search-marketplace.js';
export type { SearchMarketplaceOptions } from './search-marketplace.js';
export { parseRegistryIndex } from './registry/parse-registry-index.js';
export type { ParsedRegistryIndex } from './registry/parse-registry-index.js';
export { createRegistryIndexLoader } from './registry/registry-index-loader.js';
export type {
  RegistryIndexLoader,
  RegistryIndexLoaderOptions,
} from './registry/registry-index-loader.js';
export {
  latestInstallableVersion,
  registryInstallCommand,
  searchRegistryIndex,
} from './registry/search-registry.js';
export {
  parseRegistryReference,
  resolveRegistryInstall,
} from './registry/resolve-registry-install.js';
export type { ResolvedRegistryInstall } from './registry/resolve-registry-install.js';

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
