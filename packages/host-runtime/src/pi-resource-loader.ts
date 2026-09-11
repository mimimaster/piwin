import { join } from 'node:path';
import type {
  ExtensionSummary,
  ResourceCatalog,
  ResourceCatalogEntry,
  ResourceShadowDiagnostic,
  SessionScope,
} from '@piwin/contracts';
import { normalizeResourceId } from '@piwin/contracts';
import { ensureBundledSkillsInstalled } from '@piwin/skills';
import { collectExtensionEntryPaths } from './extension-scanner.js';
import { ensureBundledExtensionsInstalled } from './ensure-bundled-extensions.js';
import { collectPromptEntryPaths } from './prompt-scanner.js';
import { ensureBundledPromptsInstalled } from './ensure-bundled-prompts.js';
import { loadDiscoveredResources } from './discovered-resources.js';
import { skillLoaderPath } from './pi-package-inventory.js';
import { getPiwinSkillsDir } from './paths.js';

export type CreatePiResourceLoaderOptions = {
  cwd: string;
  agentDir: string;
  piwinRoot: string;
  extraSkillPaths?: string[];
  projectPath?: string;
  scope?: SessionScope;
  disabledSkillIds?: string[];
  extraExtensionPaths?: string[];
  disabledExtensionIds?: string[];
  extraPromptPaths?: string[];
  disabledPromptIds?: string[];
  allowedSkillIds?: string[];
  followPiNativeInventory?: boolean;
};

/**
 * Compile exact resource paths for the backend blueprint.
 *
 * Pi's ResourceLoader is instantiated only inside agent-host from this path
 * projection. Keeping discovery here prevents the backend from reading
 * product settings while avoiding a product package dependency on Pi.
 */
export async function createPiResourceLoader(options: CreatePiResourceLoaderOptions): Promise<{
  resourceLoader: null;
  skillPaths: string[];
  extensionPaths: string[];
  promptPaths: string[];
  resourceCatalog: ResourceCatalog;
}> {
  const projectLocalPath =
    options.scope?.kind === 'general' ? undefined : options.projectPath?.trim() || undefined;
  const skillPaths = collectSkillPaths(options);
  const disabledSkillIds = new Set(
    (options.disabledSkillIds ?? []).map((resourceId) => resourceId.toLowerCase()),
  );
  const allowedSkillIds = new Set(
    (options.allowedSkillIds ?? []).map((resourceId) => resourceId.toLowerCase()),
  );

  await ensureBundledExtensionsInstalled(options.piwinRoot);
  await ensureBundledPromptsInstalled(options.piwinRoot);
  await ensureBundledSkillsInstalled(options.piwinRoot);

  const discovered = await loadDiscoveredResources({
    piwinRoot: options.piwinRoot,
    ...(options.followPiNativeInventory !== undefined
      ? { followPiNativeInventory: options.followPiNativeInventory }
      : {}),
    ...(options.followPiNativeInventory === false ? {} : { agentDir: options.agentDir }),
    ...(projectLocalPath ? { projectPath: projectLocalPath } : {}),
    extensionsConfig: {
      extraPaths: options.extraExtensionPaths ?? [],
      disabledIds: options.disabledExtensionIds ?? [],
    },
    skillsConfig: {
      extraPaths: options.extraSkillPaths ?? [],
      disabledIds: options.disabledSkillIds ?? [],
    },
    promptsConfig: {
      extraPaths: options.extraPromptPaths ?? [],
      disabledIds: options.disabledPromptIds ?? [],
    },
  });
  const discoveredExtensions = discovered.extensions;
  const discoveredSkills = discovered.skills;
  const discoveredPrompts = discovered.prompts;
  const extensionPaths = collectExtensionEntryPaths({
    piwinRoot: options.piwinRoot,
    discovered: discoveredExtensions,
    ...(options.disabledExtensionIds ? { disabledIds: options.disabledExtensionIds } : {}),
  });
  const promptPaths = collectPromptEntryPaths({
    discovered: discoveredPrompts,
    ...(options.disabledPromptIds ? { disabledIds: options.disabledPromptIds } : {}),
  });

  const filteredSkillPaths = skillPaths.filter((resourcePath) => {
    const resourceId = resourcePath.toLowerCase();
    if (disabledSkillIds.has(resourceId)) {
      return false;
    }
    return allowedSkillIds.size === 0 || allowedSkillIds.has(resourceId);
  });
  for (const skill of discoveredSkills) {
    if (!skill.enabled) continue;
    if (allowedSkillIds.size > 0 && !allowedSkillIds.has(skill.id.toLowerCase())) continue;
    if (skill.source !== 'pi-native' && skill.source !== 'project') continue;
    const loaderPath = skillLoaderPath(skill.path);
    if (
      filteredSkillPaths.some(
        (root) => loaderPath === root || loaderPath.startsWith(`${root}/`) || loaderPath.startsWith(`${root}\\`),
      )
    ) {
      continue;
    }
    filteredSkillPaths.push(loaderPath);
  }
  const resourceEntries: ResourceCatalogEntry[] = [
    ...discoveredSkills.map((resource) => ({
      resourceId: normalizeResourceId(resource.id),
      kind: 'skill' as const,
      name: resource.name,
      description: resource.description,
      path: resource.path,
      source: resource.source,
    })),
    ...discoveredExtensions.map((resource) => ({
      resourceId: normalizeResourceId(resource.id),
      kind: 'extension' as const,
      name: resource.name,
      description: resource.description,
      path: resource.path,
      source: resource.source,
      ...(resource.contentRevision ? { contentRevision: resource.contentRevision } : {}),
      ...(resource.configuredEnabled !== undefined
        ? { configuredEnabled: resource.configuredEnabled }
        : {}),
    })),
    ...discoveredPrompts.map((resource) => ({
      resourceId: normalizeResourceId(resource.id),
      kind: 'prompt' as const,
      name: resource.name,
      description: resource.description,
      path: resource.path,
      source: resource.source,
    })),
  ];

  return {
    resourceLoader: null,
    skillPaths: filteredSkillPaths,
    extensionPaths,
    promptPaths,
    resourceCatalog: {
      version: 1,
      entries: resourceEntries,
      diagnostics: buildResourceShadowDiagnostics(resourceEntries),
    },
  };
}

/** Keep all candidates in the catalog while making precedence collisions explicit. */
export function buildResourceShadowDiagnostics(
  entries: readonly ResourceCatalogEntry[],
): ResourceShadowDiagnostic[] {
  const sourceOrder = new Map([
    ['bundled', 0],
    ['user', 1],
    ['project', 2],
    ['mapped', 3],
    ['pi-native', 4],
  ] as const);
  const winners = new Map<string, ResourceCatalogEntry>();
  const diagnostics: ResourceShadowDiagnostic[] = [];
  const ordered = entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (left, right) =>
        (sourceOrder.get(left.entry.source) ?? Number.MAX_SAFE_INTEGER) -
          (sourceOrder.get(right.entry.source) ?? Number.MAX_SAFE_INTEGER) ||
        left.index - right.index,
    )
    .map(({ entry }) => entry);

  for (const entry of ordered) {
    const resourceId = normalizeResourceId(entry.resourceId);
    const key = `${entry.kind}\u0000${resourceId}`;
    const winner = winners.get(key);
    if (!winner) {
      winners.set(key, entry);
      continue;
    }
    diagnostics.push({
      kind: winner.source === entry.source ? 'duplicate-id' : 'shadowed',
      resourceKind: entry.kind,
      resourceId,
      winnerPath: winner.path,
      winnerSource: winner.source,
      loserPath: entry.path,
      loserSource: entry.source,
    });
  }
  return diagnostics;
}

export function collectSkillPaths(options: {
  piwinRoot: string;
  extraSkillPaths?: string[];
  projectPath?: string;
  scope?: SessionScope;
}): string[] {
  const paths: string[] = [getPiwinSkillsDir(options.piwinRoot)];
  const allowProjectLocal = options.scope?.kind !== 'general';
  const projectPath = options.projectPath?.trim();
  if (allowProjectLocal && projectPath) {
    paths.push(join(projectPath, '.pi', 'skills'));
    paths.push(join(projectPath, '.agents', 'skills'));
  }
  for (const extraPath of options.extraSkillPaths ?? []) {
    if (extraPath.trim().length > 0) {
      paths.push(extraPath);
    }
  }
  return [...new Set(paths)];
}

export function extensionIdFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const baseName = normalized.split('/').pop() ?? '';
  if (baseName === 'index.ts') {
    const parts = normalized.split('/').filter(Boolean);
    const parent = parts[parts.length - 2] ?? 'extension';
    return parent.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  }
  return baseName
    .replace(/\.ts$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-');
}

export function promptIdFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const baseName = normalized.split('/').pop() ?? '';
  return baseName
    .replace(/\.md$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-');
}

export type { ExtensionSummary };
