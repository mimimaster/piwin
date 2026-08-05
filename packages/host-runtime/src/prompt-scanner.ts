import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type {
  PromptTemplateSource,
  PromptTemplateSummary,
  PromptsConfig,
} from '@piwin/contracts';
import { createDefaultPromptsConfig } from '@piwin/contracts';
import { getPiwinPromptsDir } from './paths.js';

export type ScanPromptsOptions = {
  piwinRoot: string;
  projectPath?: string;
  promptsConfig?: PromptsConfig;
};

/**
 * List Markdown prompt templates without loading them into Pi.
 * Layout: `*.md` files under ~/.piwin/prompts and project `.pi/prompts`.
 */
export async function scanPrompts(
  options: ScanPromptsOptions,
): Promise<PromptTemplateSummary[]> {
  const config = options.promptsConfig ?? createDefaultPromptsConfig();
  const disabled = new Set(config.disabledIds.map((id) => id.toLowerCase()));
  const results: PromptTemplateSummary[] = [];
  const roots: Array<{ path: string; source: PromptTemplateSource }> = [
    { path: getPiwinPromptsDir(options.piwinRoot), source: 'user' },
  ];
  if (options.projectPath) {
    roots.push({
      path: join(options.projectPath, '.pi', 'prompts'),
      source: 'project',
    });
  }
  for (const extra of config.extraPaths) {
    if (extra.trim().length > 0) {
      roots.push({ path: expandHome(extra), source: 'mapped' });
    }
  }

  for (const rootEntry of roots) {
    for (const prompt of await scanPromptRoot(rootEntry.path, rootEntry.source)) {
      if (results.some((item) => item.id === prompt.id)) {
        continue;
      }
      results.push({
        ...prompt,
        enabled: !disabled.has(prompt.id.toLowerCase()),
      });
    }
  }

  return results.sort((left, right) => left.name.localeCompare(right.name));
}

export function collectPromptEntryPaths(options: {
  discovered: PromptTemplateSummary[];
  disabledIds?: string[];
}): string[] {
  const disabled = new Set((options.disabledIds ?? []).map((id) => id.toLowerCase()));
  const paths: string[] = [];
  for (const prompt of options.discovered) {
    if (disabled.has(prompt.id.toLowerCase())) {
      continue;
    }
    paths.push(prompt.path);
  }
  return [...new Set(paths)];
}

async function scanPromptRoot(
  rootPath: string,
  source: PromptTemplateSource,
): Promise<PromptTemplateSummary[]> {
  const absoluteRoot = resolve(expandHome(rootPath));
  let entryStat;
  try {
    entryStat = await stat(absoluteRoot);
  } catch {
    return [];
  }

  if (entryStat.isFile() && absoluteRoot.endsWith('.md')) {
    const single = await buildPromptSummary(absoluteRoot, source);
    return single ? [single] : [];
  }

  if (!entryStat.isDirectory()) {
    return [];
  }

  let entries: string[] = [];
  try {
    entries = await readdir(absoluteRoot);
  } catch {
    return [];
  }

  const prompts: PromptTemplateSummary[] = [];
  for (const entryName of entries) {
    if (!entryName.endsWith('.md')) {
      continue;
    }
    const filePath = join(absoluteRoot, entryName);
    try {
      if (!(await stat(filePath)).isFile()) {
        continue;
      }
    } catch {
      continue;
    }
    const parsed = await buildPromptSummary(filePath, source);
    if (parsed) {
      prompts.push(parsed);
    }
  }
  return prompts;
}

async function buildPromptSummary(
  filePath: string,
  source: PromptTemplateSource,
): Promise<PromptTemplateSummary | null> {
  const name = basename(filePath).replace(/\.md$/i, '').trim();
  if (!name) {
    return null;
  }
  const id = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const description = await readPromptDescription(filePath);
  return {
    id,
    name,
    description,
    source,
    path: filePath,
    enabled: true,
  };
}

async function readPromptDescription(filePath: string): Promise<string> {
  try {
    const raw = await readFile(filePath, 'utf8');
    if (raw.startsWith('---')) {
      const end = raw.indexOf('\n---', 3);
      if (end !== -1) {
        const front = raw.slice(3, end);
        for (const line of front.split('\n')) {
          const match = line.match(/^description:\s*(.+)$/i);
          if (match?.[1]) {
            return match[1].trim().replace(/^["']|["']$/g, '');
          }
        }
        const body = raw.slice(end + 4).trim();
        const firstLine = body.split('\n').find((line) => line.trim().length > 0);
        if (firstLine) {
          return firstLine.trim();
        }
      }
    }
    const firstLine = raw.split('\n').find((line) => line.trim().length > 0);
    if (firstLine) {
      return firstLine.trim();
    }
  } catch {
    // ignore
  }
  return '(prompt template)';
}

function expandHome(pathValue: string): string {
  if (pathValue.startsWith('~/')) {
    return join(homedir(), pathValue.slice(2));
  }
  return pathValue;
}
