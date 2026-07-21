import { join } from 'node:path';
import type { ExtensionSummary } from '@piwin/contracts';
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
  disabledSkillIds?: string[];
  extraExtensionPaths?: string[];
  disabledExtensionIds?: string[];
  extraPromptPaths?: string[];
  disabledPromptIds?: string[];
};

/**
 * Build a Pi DefaultResourceLoader that maps piwin skill/extension/prompt dirs.
 * Call reload() before createAgentSession.
 */
export async function createPiResourceLoader(
  options: CreatePiResourceLoaderOptions,
): Promise<{
  resourceLoader: unknown;
  skillPaths: string[];
  extensionPaths: string[];
  promptPaths: string[];
}> {
  const piModule = await import('@earendil-works/pi-coding-agent');
  const DefaultResourceLoader = (piModule as { DefaultResourceLoader?: unknown })
    .DefaultResourceLoader;
  if (typeof DefaultResourceLoader !== 'function') {
    throw new Error('DefaultResourceLoader missing from @earendil-works/pi-coding-agent');
  }

  const skillPaths = collectSkillPaths(options);
  const disabled = new Set(
    (options.disabledSkillIds ?? []).map((id) => id.toLowerCase()),
  );

  await ensureBundledExtensionsInstalled(options.piwinRoot);
  await ensureBundledPromptsInstalled(options.piwinRoot);

  const discoveredExtensions = await scanExtensions({
    piwinRoot: options.piwinRoot,
    ...(options.projectPath ? { projectPath: options.projectPath } : {}),
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
    ...(options.projectPath ? { projectPath: options.projectPath } : {}),
    promptsConfig: {
      extraPaths: options.extraPromptPaths ?? [],
      disabledIds: options.disabledPromptIds ?? [],
    },
  });
  const promptPaths = collectPromptEntryPaths({
    discovered: discoveredPrompts,
    ...(options.disabledPromptIds ? { disabledIds: options.disabledPromptIds } : {}),
  });

  const LoaderCtor = DefaultResourceLoader as new (options: Record<string, unknown>) => {
    reload: () => Promise<void>;
  };

  const loaderOptions: Record<string, unknown> = {
    cwd: options.cwd,
    agentDir: options.agentDir,
    additionalSkillPaths: skillPaths,
    ...(extensionPaths.length > 0
      ? { additionalExtensionPaths: extensionPaths }
      : {}),
    ...(promptPaths.length > 0
      ? { additionalPromptTemplatePaths: promptPaths }
      : {}),
  };

  if (disabled.size > 0) {
    loaderOptions.skillsOverride = (base: {
      skills: Array<{ name?: string; id?: string }>;
      diagnostics: unknown[];
    }) => ({
      skills: base.skills.filter((skill) => {
        const key = (skill.name ?? skill.id ?? '').toLowerCase();
        return key.length === 0 || !disabled.has(key);
      }),
      diagnostics: base.diagnostics,
    });
  }

  if ((options.disabledExtensionIds ?? []).length > 0) {
    const disabledExtensionSet = new Set(
      (options.disabledExtensionIds ?? []).map((id) => id.toLowerCase()),
    );
    loaderOptions.extensionsOverride = (base: {
      extensions: Array<{ path?: string; resolvedPath?: string }>;
      errors: unknown[];
      runtime: unknown;
    }) => ({
      extensions: base.extensions.filter((extension) => {
        const key = extensionIdFromPath(extension.resolvedPath ?? extension.path ?? '');
        return key.length === 0 || !disabledExtensionSet.has(key);
      }),
      errors: base.errors,
      runtime: base.runtime,
    });
  }

  if ((options.disabledPromptIds ?? []).length > 0) {
    const disabledPromptSet = new Set(
      (options.disabledPromptIds ?? []).map((id) => id.toLowerCase()),
    );
    loaderOptions.promptsOverride = (base: {
      prompts: Array<{ name?: string; path?: string }>;
      diagnostics: unknown[];
    }) => ({
      prompts: base.prompts.filter((prompt) => {
        const key = promptIdFromPath(prompt.path ?? prompt.name ?? '');
        return key.length === 0 || !disabledPromptSet.has(key);
      }),
      diagnostics: base.diagnostics,
    });
  }

  const resourceLoader = new LoaderCtor(loaderOptions);
  await resourceLoader.reload();
  return { resourceLoader, skillPaths, extensionPaths, promptPaths };
}

export function collectSkillPaths(options: {
  piwinRoot: string;
  extraSkillPaths?: string[];
  projectPath?: string;
}): string[] {
  const paths: string[] = [getPiwinSkillsDir(options.piwinRoot)];
  if (options.projectPath) {
    paths.push(join(options.projectPath, '.pi', 'skills'));
    paths.push(join(options.projectPath, '.agents', 'skills'));
  }
  for (const extra of options.extraSkillPaths ?? []) {
    if (extra.trim().length > 0) {
      paths.push(extra);
    }
  }
  return [...new Set(paths)];
}

export function extensionIdFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const base = normalized.split('/').pop() ?? '';
  if (base === 'index.ts') {
    const parts = normalized.split('/').filter(Boolean);
    const parent = parts[parts.length - 2] ?? 'extension';
    return parent.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  }
  return base.replace(/\.ts$/i, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
}

export function promptIdFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const base = normalized.split('/').pop() ?? '';
  return base.replace(/\.md$/i, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
}

export type { ExtensionSummary };
