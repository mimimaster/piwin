/**
 * Locate the isolated agent worker entry for RpcSdkWorkerClient.
 *
 * Packaged Host has `agent-worker.mjs` beside the bundle. Desktop/CLI source
 * trees do not: they run Host via tsx and never call `bundle:host`. Subagents
 * still need a worker process, so source checkouts fall back to the TypeScript
 * entry plus `--import tsx`.
 */

import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Same threshold Tauri uses to reject `ensure-packaging-placeholders` stubs. */
const MIN_PACKAGED_WORKER_BYTES = 200;

export const MISSING_WORKER_ARTIFACT_ERROR =
  'packaged agent worker artifact is missing; run bundle:host or provide a test workerScript';

export type ResolvedWorkerLaunch = {
  workerScript: string;
  nodeArgs: string[];
};

export type ResolveWorkerLaunchOptions = {
  workerScript?: string;
  nodeArgs?: readonly string[];
  env?: NodeJS.ProcessEnv;
  /** Override import.meta.url so tests can point at a fixture directory. */
  fromUrl?: string;
  cwd?: string;
};

export function resolveWorkerLaunch(
  options: ResolveWorkerLaunchOptions = {},
): ResolvedWorkerLaunch {
  const fromUrl = options.fromUrl ?? import.meta.url;
  const nodeArgs = options.nodeArgs ?? [];
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();

  const explicit = options.workerScript?.trim();
  if (explicit !== undefined && explicit.length > 0) {
    return { workerScript: explicit, nodeArgs: withTsxIfNeeded(explicit, nodeArgs, fromUrl, cwd) };
  }

  const fromEnv = env.PIWIN_AGENT_WORKER_SCRIPT?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) {
    const workerScript = resolve(fromEnv);
    return { workerScript, nodeArgs: withTsxIfNeeded(workerScript, nodeArgs, fromUrl, cwd) };
  }

  const packaged = sibling(fromUrl, 'agent-worker.mjs');
  if (isUsablePackagedWorker(packaged)) {
    return { workerScript: packaged, nodeArgs: [...nodeArgs] };
  }

  const compiled = sibling(fromUrl, 'rpc-sdk-worker-entry.js');
  if (existsSync(compiled)) {
    return { workerScript: compiled, nodeArgs: [...nodeArgs] };
  }

  const sourceEntry = sibling(fromUrl, 'rpc-sdk-worker-entry.ts');
  if (existsSync(sourceEntry)) {
    return {
      workerScript: sourceEntry,
      nodeArgs: withTsxIfNeeded(sourceEntry, nodeArgs, fromUrl, cwd),
    };
  }

  const bundled = findBundledWorker([cwd, dirname(fileURLToPath(fromUrl))]);
  if (bundled !== undefined) {
    return { workerScript: bundled, nodeArgs: [...nodeArgs] };
  }

  throw new Error(MISSING_WORKER_ARTIFACT_ERROR);
}

function sibling(fromUrl: string, name: string): string {
  return fileURLToPath(new URL(`./${name}`, fromUrl));
}

function isUsablePackagedWorker(path: string): boolean {
  try {
    const stat = statSync(path);
    return stat.isFile() && stat.size >= MIN_PACKAGED_WORKER_BYTES;
  } catch {
    return false;
  }
}

function findBundledWorker(startDirs: string[]): string | undefined {
  const seen = new Set<string>();
  for (const start of startDirs) {
    let dir = start;
    for (let depth = 0; depth < 12; depth += 1) {
      if (seen.has(dir)) break;
      seen.add(dir);
      const candidate = join(dir, 'dist-host', 'agent-worker.mjs');
      if (isUsablePackagedWorker(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return undefined;
}

function isSourceTypeScript(path: string): boolean {
  return path.endsWith('.ts') && !path.endsWith('.d.ts');
}

function nodeArgsImportTsx(nodeArgs: readonly string[]): boolean {
  for (let index = 0; index < nodeArgs.length - 1; index += 1) {
    if (nodeArgs[index] === '--import' && nodeArgs[index + 1] === 'tsx') return true;
  }
  return false;
}

function withTsxIfNeeded(
  script: string,
  nodeArgs: readonly string[],
  fromUrl: string,
  cwd: string,
): string[] {
  const args = [...nodeArgs];
  if (!isSourceTypeScript(script) || nodeArgsImportTsx(args)) return args;
  if (resolveTsxLoader(fromUrl, cwd) === undefined) {
    throw new Error(MISSING_WORKER_ARTIFACT_ERROR);
  }
  return ['--import', 'tsx', ...args];
}

function resolveTsxLoader(fromUrl: string, cwd: string): string | undefined {
  const starts = [fileURLToPath(fromUrl), join(cwd, 'package.json')];
  for (const start of starts) {
    try {
      return createRequire(start).resolve('tsx');
    } catch {
      // Try the next resolution root.
    }
  }
  return undefined;
}
