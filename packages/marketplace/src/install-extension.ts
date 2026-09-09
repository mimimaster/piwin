import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { InstallSource } from '@piwin/contracts';
import { createExtensionRevisionStore } from '@piwin/extensions';
import { resolveCloneContentRoot } from './clone-content-root.js';

const execFileAsync = promisify(execFile);

export type InstallExtensionResult = {
  extensionId: string;
  targetPath: string;
  packageRoot: string;
  contentRevision: string;
  registryRevision: string;
  source: InstallSource;
  /** First install is inactive; updates preserve the existing user intent. */
  configuredEnabled: boolean;
};

export type InstallExtensionOptions = {
  piwinRoot: string;
  source: InstallSource;
  /** Override display/directory name in the managed registry. */
  name?: string;
};

/**
 * Acquire a Pi extension into the Host-owned immutable revision store.
 *
 * Installing only stages an inactive revision. It never overwrites a mutable
 * path and never imports or executes the extension entrypoint.
 */
export async function installExtension(
  options: InstallExtensionOptions,
): Promise<InstallExtensionResult> {
  const store = createExtensionRevisionStore(options.piwinRoot);
  if (options.source.kind === 'local') {
    const absoluteSource = resolve(options.source.path);
    const staged = await store.stage({
      sourcePath: absoluteSource,
      ...(options.name ? { name: options.name } : {}),
      source: 'user',
      sourceLocator: `local:${absoluteSource}`,
    });
    return {
      extensionId: staged.extensionId,
      targetPath: staged.targetPath,
      packageRoot: staged.packageRoot,
      contentRevision: staged.contentRevision,
      registryRevision: staged.registryRevision,
      source: { kind: 'local', path: absoluteSource },
      configuredEnabled: staged.record.configuredEnabled,
    };
  }
  return installExtensionFromGit(store, {
    ...options,
    source: options.source,
  });
}

async function installExtensionFromGit(
  store: ReturnType<typeof createExtensionRevisionStore>,
  options: Omit<InstallExtensionOptions, 'source'> & {
    source: Extract<InstallSource, { kind: 'git' }>;
  },
): Promise<InstallExtensionResult> {
  const clonePath = await mkdtemp(`${tmpdir()}/piwin-extension-git-`);
  const args = ['clone', '--depth', '1'];
  if (options.source.ref) {
    args.push('--branch', options.source.ref);
  }
  args.push(options.source.url, clonePath);
  try {
    await execFileAsync('git', args, { timeout: 120_000 });
    const contentRoot = resolveCloneContentRoot(clonePath, options.source.subdir);
    const resolvedCommit = await readGitCommit(clonePath);
    const sourceLocator = `git:${options.source.url}@${resolvedCommit}`;
    const staged = await store.stage({
      sourcePath: contentRoot,
      ...(options.name ? { name: options.name } : {}),
      source: 'user',
      sourceLocator,
    });
    const source: InstallSource = {
      kind: 'git',
      url: options.source.url,
      ...(options.source.ref ? { ref: options.source.ref } : {}),
      ...(options.source.subdir ? { subdir: options.source.subdir } : {}),
    };
    return {
      extensionId: staged.extensionId,
      targetPath: staged.targetPath,
      packageRoot: staged.packageRoot,
      contentRevision: staged.contentRevision,
      registryRevision: staged.registryRevision,
      source,
      configuredEnabled: staged.record.configuredEnabled,
    };
  } catch (error) {
    throw new Error(
      `git extension install failed: ${describeGitInstallError(error, clonePath, options.source)}`,
    );
  } finally {
    await rm(clonePath, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Turn a raw clone/stage failure into an actionable sentence. The clone lives in
 * an OS temp directory whose path is meaningless to the user, so strip it, and
 * translate the common structural failures into next steps.
 */
function describeGitInstallError(
  error: unknown,
  clonePath: string,
  source: Extract<InstallSource, { kind: 'git' }>,
): string {
  const raw = (error instanceof Error ? error.message : String(error)).trim();
  const message = raw.split(clonePath).join('the cloned repository');
  const subdirHint = source.subdir
    ? `The subdirectory "${source.subdir}" has no index.ts entry point.`
    : 'The repository root has no index.ts entry point. If the extension lives in a subfolder, set the subdirectory (for example "extensions"). Extensions published only as npm packages cannot be installed from a Git URL.';
  if (/must contain index\.ts/i.test(message)) return subdirHint;
  if (/must be a \.ts module/i.test(message)) {
    return 'The entry point must be a TypeScript (.ts) module. Point the subdirectory at the extension file or its package folder.';
  }
  if (/(not found|could not read|repository .* does not exist|authentication failed)/i.test(raw)) {
    return `Could not clone ${source.url}. Check that the URL is correct and the repository is public.`;
  }
  if (/timed out|ETIMEDOUT/i.test(raw)) {
    return `Cloning ${source.url} timed out. Check your network connection and try again.`;
  }
  return message;
}

async function readGitCommit(clonePath: string): Promise<string> {
  const result = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: clonePath,
    timeout: 15_000,
  });
  const commit = result.stdout.trim();
  if (!/^[0-9a-f]{40}$/i.test(commit)) {
    throw new Error(`git clone returned invalid commit: ${basename(clonePath)}`);
  }
  return commit.toLowerCase();
}
