import { createHash } from 'node:crypto';
import type {
  PiwinConfig,
  ResourceCatalog,
  ResourceInstance,
  ResourceManifest,
  SessionScope,
} from '@piwin/contracts';
import { normalizeResourceId } from '@piwin/contracts';
import { buildResourceShadowDiagnostics, createPiResourceLoader } from './pi-resource-loader.js';
import { getPiAgentDir } from './paths.js';

export type DiscoverResourcesOptions = {
  cwd: string;
  piwinRoot: string;
  scope: SessionScope;
  config: PiwinConfig;
};

export type DiscoveredResources = {
  skillPaths: string[];
  extensionPaths: string[];
  promptPaths: string[];
  catalog?: ResourceCatalog;
};

export function computeProjectRevision(scope: SessionScope): string {
  return createHash('sha256').update(JSON.stringify(scope)).digest('hex').slice(0, 12);
}

/** Compute a revision from the resource catalog before activation filtering. */
export function computeResourceRevision(catalog: ResourceCatalog): string {
  const payload = JSON.stringify({
    entries: [...catalog.entries].sort((left, right) =>
      `${left.kind}:${left.resourceId}:${left.path}:${left.contentRevision ?? ''}`.localeCompare(
        `${right.kind}:${right.resourceId}:${right.path}:${right.contentRevision ?? ''}`,
      ),
    ),
    diagnostics: catalog.diagnostics,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 12);
}

/** Compute the exact active Pi Extension revision set identity. */
export function computeExtensionSetRevision(
  entries: readonly ResourceCatalog['entries'][number][],
): string {
  const payload = entries
    .filter((entry) => entry.kind === 'extension')
    .map((entry) => ({
      resourceId: entry.resourceId,
      path: entry.path,
      contentRevision: entry.contentRevision ?? null,
    }))
    .sort((left, right) => left.resourceId.localeCompare(right.resourceId));
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 12);
}

/** Discover the worker's skill, extension, and prompt paths through the shared loader. */
export async function discoverResourcesDefault(
  options: DiscoverResourcesOptions,
): Promise<DiscoveredResources> {
  const extraSkillPaths = options.config.skills?.extraPaths ?? [];
  const disabledSkillIds = options.config.skills?.disabledIds ?? [];
  const extraExtensionPaths = options.config.extensions?.extraPaths ?? [];
  const disabledExtensionIds = options.config.extensions?.disabledIds ?? [];
  const extraPromptPaths = options.config.prompts?.extraPaths ?? [];
  const disabledPromptIds = options.config.prompts?.disabledIds ?? [];

  const { skillPaths, extensionPaths, promptPaths, resourceCatalog } = await createPiResourceLoader(
    {
      cwd: options.cwd,
      agentDir: getPiAgentDir(),
      piwinRoot: options.piwinRoot,
      scope: options.scope,
      ...(options.scope.kind === 'project' ? { projectPath: options.scope.projectPath } : {}),
      ...(extraSkillPaths.length > 0 ? { extraSkillPaths } : {}),
      ...(disabledSkillIds.length > 0 ? { disabledSkillIds } : {}),
      ...(extraExtensionPaths.length > 0 ? { extraExtensionPaths } : {}),
      ...(disabledExtensionIds.length > 0 ? { disabledExtensionIds } : {}),
      ...(extraPromptPaths.length > 0 ? { extraPromptPaths } : {}),
      ...(disabledPromptIds.length > 0 ? { disabledPromptIds } : {}),
    },
  );

  return { skillPaths, extensionPaths, promptPaths, catalog: resourceCatalog };
}

/** Project the resolver's active catalog entries into the worker manifest. */
export function buildResourceManifest(
  activeEntries: ResourceCatalog['entries'],
  catalog: ResourceCatalog,
): ResourceManifest {
  const instances: ResourceInstance[] = activeEntries.map((entry) => ({
    resourceId: entry.resourceId,
    kind: entry.kind,
    name: entry.name,
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    path: entry.path,
    source: entry.source,
    ...(entry.contentRevision ? { contentRevision: entry.contentRevision } : {}),
    ...(entry.piNativeRoot !== undefined ? { piNativeRoot: entry.piNativeRoot } : {}),
  }));
  return {
    skills: instances.filter((entry) => entry.kind === 'skill'),
    extensions: instances.filter((entry) => entry.kind === 'extension'),
    prompts: instances.filter((entry) => entry.kind === 'prompt'),
    diagnostics: catalog.diagnostics,
  };
}

export function buildFallbackResourceCatalog(resources: DiscoveredResources): ResourceCatalog {
  const entries = [
    ...resources.skillPaths.map((path) => fallbackResourceEntry(path, 'skill')),
    ...resources.extensionPaths.map((path) => fallbackResourceEntry(path, 'extension')),
    ...resources.promptPaths.map((path) => fallbackResourceEntry(path, 'prompt')),
  ];
  return { version: 1, entries, diagnostics: buildResourceShadowDiagnostics(entries) };
}

function fallbackResourceEntry(
  path: string,
  kind: 'skill' | 'extension' | 'prompt',
): ResourceCatalog['entries'][number] {
  return {
    resourceId: normalizeResourceId(path),
    kind,
    name: path,
    path,
    source: 'user',
  };
}

export function normalizeDisabledResourceIds(ids: readonly string[]): string[] {
  const normalized = new Set<string>();
  for (const id of ids) {
    try {
      normalized.add(normalizeResourceId(id));
    } catch {
      // Config validation owns the user-facing diagnostic at this boundary.
    }
  }
  return [...normalized].sort((left, right) => left.localeCompare(right));
}
