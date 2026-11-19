/**
 * File-based system prompt discovery & bounded reader for `.md` and `.txt` references.
 */
import { mkdir, readdir, readFile, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  SystemPromptCandidateSource,
  SystemPromptFileCandidate,
  SystemPromptFileReadItem,
  SystemPromptFilesListData,
  SystemPromptFilesReadData,
} from '@piwin/contracts';
import {
  formatError,
  isSupportedSystemPromptFilePath,
  MAX_SYSTEM_PROMPT_CONTENT_CHARS,
  MAX_SYSTEM_PROMPT_FILE_BYTES,
  MAX_SYSTEM_PROMPT_STACK_FILES,
} from '@piwin/contracts';
import { getPiwinRoot, getPiwinSystemPromptsDir } from './paths.js';

const SKIPPED_PROJECT_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'target',
  '.next',
  '.turbo',
  'coverage',
  'out',
  '.cache',
]);

function expandHomePrefix(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (trimmed === '~') {
    return os.homedir();
  }
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

export function resolveSystemPromptFilePath(
  rawPath: string,
  options: { piwinRoot?: string | undefined; projectPath?: string | undefined },
): string {
  const expanded = expandHomePrefix(rawPath);
  if (path.isAbsolute(expanded)) {
    return path.resolve(expanded);
  }
  const projectBase = options.projectPath?.trim();
  if (projectBase) {
    return path.resolve(projectBase, expanded);
  }
  const systemPromptsDir = getPiwinSystemPromptsDir(getPiwinRoot(options.piwinRoot));
  return path.resolve(systemPromptsDir, expanded);
}

function extensionKind(fileName: string): 'md' | 'txt' {
  return fileName.toLowerCase().endsWith('.txt') ? 'txt' : 'md';
}

function shouldSkipDirectory(
  name: string,
  source: SystemPromptCandidateSource,
): boolean {
  if (source === 'global') {
    return name.startsWith('.');
  }
  if (SKIPPED_PROJECT_DIRS.has(name)) {
    return true;
  }
  return name.startsWith('.') && name !== '.pi';
}

async function scanPromptCandidatesInRoot(params: {
  rootDir: string;
  source: SystemPromptCandidateSource;
  maxDepth: number;
  maxFiles: number;
  seenRealPaths: Set<string>;
}): Promise<SystemPromptFileCandidate[]> {
  const results: SystemPromptFileCandidate[] = [];
  let canonicalRoot: string;
  try {
    const rootStats = await stat(params.rootDir);
    if (!rootStats.isDirectory()) {
      return results;
    }
    canonicalRoot = await realpath(params.rootDir);
  } catch {
    return results;
  }

  const queue: Array<{ dir: string; depth: number }> = [{ dir: canonicalRoot, depth: 0 }];
  while (queue.length > 0 && results.length < params.maxFiles) {
    const current = queue.shift();
    if (!current) break;

    let entries;
    try {
      entries = await readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (results.length >= params.maxFiles) break;
      if (entry.name === '.' || entry.name === '..') continue;
      const fullPath = path.join(current.dir, entry.name);

      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (!isDir && !isFile && entry.isSymbolicLink()) {
        try {
          const linked = await stat(fullPath);
          isDir = linked.isDirectory();
          isFile = linked.isFile();
        } catch {
          continue;
        }
      }

      if (isDir) {
        if (
          current.depth + 1 < params.maxDepth &&
          !shouldSkipDirectory(entry.name, params.source)
        ) {
          queue.push({ dir: fullPath, depth: current.depth + 1 });
        }
        continue;
      }

      if (!isFile) continue;
      if (entry.name.startsWith('.') || !isSupportedSystemPromptFilePath(entry.name)) {
        continue;
      }

      try {
        const real = await realpath(fullPath);
        if (params.seenRealPaths.has(real)) continue;
        const fileStats = await stat(real);
        if (!fileStats.isFile()) continue;
        params.seenRealPaths.add(real);
        const rel = path.relative(canonicalRoot, real).split(path.sep).join('/');
        results.push({
          path: real,
          displayPath: rel || entry.name,
          fileName: entry.name,
          extension: extensionKind(entry.name),
          source: params.source,
          sizeBytes: fileStats.size,
          updatedAtMs: Math.round(fileStats.mtimeMs),
        });
      } catch {
        continue;
      }
    }
  }

  return results;
}

export async function listSystemPromptCandidateFiles(options: {
  piwinRoot?: string | undefined;
  projectPath?: string | undefined;
}): Promise<SystemPromptFilesListData> {
  const systemPromptsDir = getPiwinSystemPromptsDir(getPiwinRoot(options.piwinRoot));
  await mkdir(systemPromptsDir, { recursive: true });

  const seenRealPaths = new Set<string>();
  const globalFiles = await scanPromptCandidatesInRoot({
    rootDir: systemPromptsDir,
    source: 'global',
    maxDepth: 4,
    maxFiles: 300,
    seenRealPaths,
  });

  const projectPath = options.projectPath?.trim();
  const projectFiles = projectPath
    ? await scanPromptCandidatesInRoot({
        rootDir: projectPath,
        source: 'project',
        maxDepth: 5,
        maxFiles: 400,
        seenRealPaths,
      })
    : [];

  globalFiles.sort((a, b) => a.displayPath.localeCompare(b.displayPath));
  projectFiles.sort((a, b) => a.displayPath.localeCompare(b.displayPath));

  return {
    systemPromptsDir,
    files: [...globalFiles, ...projectFiles],
  };
}

export async function readSystemPromptFiles(options: {
  paths: readonly string[];
  piwinRoot?: string | undefined;
  projectPath?: string | undefined;
}): Promise<SystemPromptFilesReadData> {
  const boundedPaths = options.paths.slice(0, MAX_SYSTEM_PROMPT_STACK_FILES);
  const files: SystemPromptFileReadItem[] = [];

  for (const rawPath of boundedPaths) {
    const trimmed = typeof rawPath === 'string' ? rawPath.trim() : '';
    const fileName = trimmed.split(/[\\/]/).pop() || trimmed || 'prompt';

    if (!isSupportedSystemPromptFilePath(trimmed)) {
      files.push({
        path: trimmed,
        resolvedPath: trimmed,
        fileName,
        exists: false,
        content: '',
        sizeBytes: 0,
        error: 'Only .md and .txt files are supported.',
      });
      continue;
    }

    const resolvedPath = resolveSystemPromptFilePath(trimmed, {
      piwinRoot: options.piwinRoot,
      projectPath: options.projectPath,
    });
    const resolvedName = path.basename(resolvedPath) || fileName;

    try {
      const stats = await stat(resolvedPath);
      if (!stats.isFile()) {
        files.push({
          path: trimmed,
          resolvedPath,
          fileName: resolvedName,
          exists: false,
          content: '',
          sizeBytes: 0,
          error: 'Path is not a file.',
        });
        continue;
      }
      if (stats.size > MAX_SYSTEM_PROMPT_FILE_BYTES) {
        files.push({
          path: trimmed,
          resolvedPath,
          fileName: resolvedName,
          exists: false,
          content: '',
          sizeBytes: stats.size,
          updatedAtMs: Math.round(stats.mtimeMs),
          error: `File exceeds max size (${MAX_SYSTEM_PROMPT_FILE_BYTES} bytes).`,
        });
        continue;
      }
      const rawText = await readFile(resolvedPath, 'utf8');
      const content =
        rawText.length > MAX_SYSTEM_PROMPT_CONTENT_CHARS
          ? rawText.slice(0, MAX_SYSTEM_PROMPT_CONTENT_CHARS)
          : rawText;
      files.push({
        path: trimmed,
        resolvedPath,
        fileName: resolvedName,
        exists: true,
        content,
        sizeBytes: stats.size,
        updatedAtMs: Math.round(stats.mtimeMs),
      });
    } catch (error) {
      files.push({
        path: trimmed,
        resolvedPath,
        fileName: resolvedName,
        exists: false,
        content: '',
        sizeBytes: 0,
        error: formatError(error),
      });
    }
  }

  return { files };
}
