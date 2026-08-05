import { join } from 'node:path';
import type { ExtensionSummary, SessionScope } from '@piwin/contracts';
import { collectExtensionEntryPaths, scanExtensions } from './extension-scanner.js';
import { ensureBundledExtensionsInstalled } from './ensure-bundled-extensions.js';
import { collectPromptEntryPaths, scanPrompts } from './prompt-scanner.js';
import { ensureBundledPromptsInstalled } from './ensure-bundled-prompts.js';
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
};

/**
 * Compile exact resource paths for the backend blueprint.
 *
 * Pi's ResourceLoader is instantiated only inside agent-host from this path
 * projection. Keeping discovery here prevents the backend from reading
 * product settings while avoiding a product package dependency on Pi.
 */
export async function createPiResourceLoader(
  options: CreatePiResourceLoaderOptions,
): Promise<{
  resourceLoader: null;
  skillPaths: string[];
  extensionPaths: string[];
  promptPaths: string[];
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

  const discoveredExtensions = await scanExtensions({
    piwinRoot: options.piwinRoot,
    ...(projectLocalPath ? { projectPath: projectLocalPath } : {}),
    extensionsConfig: {
      extraPaths: options.extraExtensionPaths ?? [],
      disabledIds: options.disabledExtensionIds ?? [],
    },
  });
  const extensionPaths = collectExtensionEntryPaths({
    piwinRoot: options.piwinRoot,
    discovered: discoveredExtensions,
    ...(options.disabledExtensionIds ? { disabledIds: options.disabledExtensionIds } : {}),
  });

  const discoveredPrompts = await scanPrompts({
    piwinRoot: options.piwinRoot,
    ...(projectLocalPath ? { projectPath: projectLocalPath } : {}),
    promptsConfig: {
      extraPaths: options.extraPromptPaths ?? [],
      disabledIds: options.disabledPromptIds ?? [],
    },
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

  return {
    resourceLoader: null,
    skillPaths: filteredSkillPaths,
    extensionPaths,
    promptPaths,
  };
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
