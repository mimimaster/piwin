/** Host-owned discovery of the exact instruction files admitted to a session. */

import { stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type {
  ContextManifest,
  ContextPolicy,
  ResolvedContextFile,
  SessionScope,
} from '@piwin/contracts';
import { resolveContextManifest } from './capabilities/context-policy-resolver.js';

const AGENTS_FILE_CANDIDATES = [
  { name: 'AGENTS.md', kind: 'agents' },
  { name: 'AGENTS.MD', kind: 'agents' },
  { name: 'CLAUDE.md', kind: 'claude' },
  { name: 'CLAUDE.MD', kind: 'claude' },
] as const;

export type DiscoverContextManifestOptions = {
  scope: SessionScope;
  workingDirectory: string;
  agentDir: string;
  policy: ContextPolicy;
};

/**
 * Mirror Pi's instruction precedence in the Host, then freeze the result.
 * The adapter must consume this manifest without performing another scan.
 */
export async function discoverContextManifest(
  options: DiscoverContextManifestOptions,
): Promise<ContextManifest> {
  const piNativeFiles = await discoverPiNativeFiles(options.agentDir);
  const projectAgentsFiles =
    options.scope.kind === 'project'
      ? await discoverAncestorAgentsFiles(options.workingDirectory)
      : [];
  const projectSystemPrompts =
    options.scope.kind === 'project'
      ? await discoverProjectSystemPrompts(options.scope.projectPath)
      : [];

  return resolveContextManifest(options.policy, {
    projectAgentsFiles,
    projectSystemPrompts,
    piNativeFiles,
  });
}

async function discoverPiNativeFiles(agentDir: string): Promise<ResolvedContextFile[]> {
  const files: ResolvedContextFile[] = [];
  const agentsFile = await findAgentsFile(agentDir, 'pi-native');
  if (agentsFile) {
    files.push(agentsFile);
  }
  await pushIfFile(files, join(agentDir, 'SYSTEM.md'), 'system', 'pi-native');
  await pushIfFile(files, join(agentDir, 'APPEND_SYSTEM.md'), 'append-system', 'pi-native');
  return files;
}

async function discoverAncestorAgentsFiles(
  workingDirectory: string,
): Promise<ResolvedContextFile[]> {
  const files: ResolvedContextFile[] = [];
  let currentDirectory = resolve(workingDirectory);
  while (true) {
    const file = await findAgentsFile(currentDirectory, 'project');
    if (file) {
      // Pi presents ancestor instructions before more-specific descendants.
      files.unshift(file);
    }
    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return files;
    }
    currentDirectory = parentDirectory;
  }
}

async function discoverProjectSystemPrompts(
  workingDirectory: string,
): Promise<ResolvedContextFile[]> {
  const files: ResolvedContextFile[] = [];
  const projectPiDirectory = join(resolve(workingDirectory), '.pi');
  await pushIfFile(files, join(projectPiDirectory, 'SYSTEM.md'), 'system', 'project');
  await pushIfFile(
    files,
    join(projectPiDirectory, 'APPEND_SYSTEM.md'),
    'append-system',
    'project',
  );
  return files;
}

async function findAgentsFile(
  directory: string,
  source: ResolvedContextFile['source'],
): Promise<ResolvedContextFile | undefined> {
  for (const candidate of AGENTS_FILE_CANDIDATES) {
    const absolutePath = join(directory, candidate.name);
    if (await isFile(absolutePath)) {
      return { kind: candidate.kind, source, absolutePath };
    }
  }
  return undefined;
}

async function pushIfFile(
  files: ResolvedContextFile[],
  absolutePath: string,
  kind: ResolvedContextFile['kind'],
  source: ResolvedContextFile['source'],
): Promise<void> {
  if (await isFile(absolutePath)) {
    files.push({ kind, source, absolutePath });
  }
}

async function isFile(absolutePath: string): Promise<boolean> {
  try {
    return (await stat(absolutePath)).isFile();
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }
    throw error;
  }
}

function isMissingPathError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}
