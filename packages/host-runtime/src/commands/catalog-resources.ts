/**
 * Shared resource discovery for catalog-style commands (skills, extensions,
 * prompts, marketplace inventory): one config read, one scanner pass.
 */
import { loadPiwinConfig } from '../config-store.js';
import { loadDiscoveredResources } from '../discovered-resources.js';
import { ensureBundledExtensionsInstalled } from '../ensure-bundled-extensions.js';
import type { HostCommandContext } from './host-command-context.js';

export async function loadCatalogResources(rootDir: string, projectPath?: string) {
  const config = await loadPiwinConfig(rootDir);
  const path = typeof projectPath === 'string' && projectPath.trim() ? projectPath.trim() : undefined;
  return loadDiscoveredResources({
    piwinRoot: rootDir,
    ...(path ? { projectPath: path } : {}),
    ...(config.extensions ? { extensionsConfig: config.extensions } : {}),
    ...(config.skills ? { skillsConfig: config.skills } : {}),
    ...(config.prompts ? { promptsConfig: config.prompts } : {}),
  });
}

export async function pushExtensionCatalog(
  context: HostCommandContext,
  rootDir: string,
  registryRevision: string,
): Promise<void> {
  await ensureBundledExtensionsInstalled(rootDir);
  const discovered = await loadCatalogResources(rootDir);
  context.push({
    type: 'extension/catalog-updated',
    registryRevision,
    extensions: discovered.extensions,
  });
}
