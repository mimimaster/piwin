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
  /**
   * Project root for project-local skills/extensions/prompts.
   * Omitted (or general scope) → user/bundled only.
   */
  projectPath?: string;
  /** When general, project-local discovery is skipped even if projectPath is set. */
  scope?: SessionScope;
  disabledSkillIds?: string[];
  extraExtensionPaths?: string[];
  disabledExtensionIds?: string[];
  extraPromptPaths?: string[];
  disabledPromptIds?: string[];
  /**
   * CE-SUB-PROF: profile skill allowlist. When present, filter discovered
   * enabled skills to this allowlist after applying global disabled ids.
   * When absent, preserve current global skill behavior.
   */
  allowedSkillIds?: string[];
};

/**
 * Build a Pi DefaultResourceLoader that maps piwin skill/extension/prompt dirs.
 * Call reload() before createAgentSession.
 */
export async function createPiResourceLoader(options: CreatePiResourceLoaderOptions): Promise<{
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

  const projectLocalPath =
    options.scope?.kind === 'general' ? undefined : options.projectPath?.trim() || undefined;

  const skillPaths = collectSkillPaths(options);
  const disabled = new Set((options.disabledSkillIds ?? []).map((id) => id.toLowerCase()));

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

  const LoaderCtor = DefaultResourceLoader as new (options: Record<string, unknown>) => {
    reload: () => Promise<void>;
  };

  const loaderOptions: Record<string, unknown> = {
    cwd: options.cwd,
    agentDir: options.agentDir,
    additionalSkillPaths: skillPaths,
    ...(extensionPaths.length > 0 ? { additionalExtensionPaths: extensionPaths } : {}),
    ...(promptPaths.length > 0 ? { additionalPromptTemplatePaths: promptPaths } : {}),
  };

  if (disabled.size > 0 || (options.allowedSkillIds ?? []).length > 0) {
    const allowedSkillSet = new Set((options.allowedSkillIds ?? []).map((id) => id.toLowerCase()));
    const hasAllowlist = allowedSkillSet.size > 0;
    loaderOptions.skillsOverride = (base: {
      skills: Array<{ name?: string; id?: string }>;
      diagnostics: unknown[];
    }) => ({
      skills: base.skills.filter((skill) => {
        const key = (skill.name ?? skill.id ?? '').toLowerCase();
        if (key.length === 0) return true;
        if (disabled.has(key)) return false;
        // CE-SUB-PROF: when a profile allowlist is set, only keep skills in it.
        if (hasAllowlist && !allowedSkillSet.has(key)) return false;
        return true;
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
  scope?: SessionScope;
}): string[] {
  const paths: string[] = [getPiwinSkillsDir(options.piwinRoot)];
  const allowProjectLocal = options.scope?.kind !== 'general';
  const projectPath = options.projectPath?.trim();
  if (allowProjectLocal && projectPath) {
    paths.push(join(projectPath, '.pi', 'skills'));
    paths.push(join(projectPath, '.agents', 'skills'));
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
  return base
    .replace(/\.ts$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-');
}

export function promptIdFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const base = normalized.split('/').pop() ?? '';
  return base
    .replace(/\.md$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-');
}

export type { ExtensionSummary };
