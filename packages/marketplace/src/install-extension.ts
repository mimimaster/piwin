import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { InstallSource } from '@piwin/contracts';
import { resolveCloneContentRoot } from './clone-content-root.js';

const execFileAsync = promisify(execFile);

export type InstallExtensionResult = {
  extensionId: string;
  targetPath: string;
  source: InstallSource;
};

export type InstallExtensionOptions = {
  piwinRoot: string;
  source: InstallSource;
  /** Override destination name under ~/.piwin/extensions */
  name?: string;
};

/**
 * Install a Pi extension into ~/.piwin/extensions.
 * - local file: copy `*.ts` into extensions root
 * - local dir: must contain index.ts (package layout) or a single *.ts
 * - git: clone then copy entry
 */
export async function installExtension(
  options: InstallExtensionOptions,
): Promise<InstallExtensionResult> {
  const extensionsRoot = join(options.piwinRoot, 'extensions');
  await mkdir(extensionsRoot, { recursive: true });

  if (options.source.kind === 'local') {
    return installExtensionFromLocal(extensionsRoot, options.source.path, options.name);
  }
  return installExtensionFromGit(extensionsRoot, options.source, options.name);
}

async function installExtensionFromLocal(
  extensionsRoot: string,
  sourcePath: string,
  nameOverride?: string,
): Promise<InstallExtensionResult> {
  const absoluteSource = resolve(sourcePath);
  const sourceStat = await stat(absoluteSource);

  if (sourceStat.isFile()) {
    if (!absoluteSource.endsWith('.ts') || absoluteSource.endsWith('.d.ts')) {
      throw new Error(`Local extension file must be a .ts module: ${absoluteSource}`);
    }
    const baseName = nameOverride ?? basename(absoluteSource).replace(/\.ts$/i, '');
    const safeName = sanitizeName(baseName);
    const targetPath = join(extensionsRoot, `${safeName}.ts`);
    const body = await readFile(absoluteSource, 'utf8');
    await writeFile(targetPath, body, 'utf8');
    return {
      extensionId: safeName.toLowerCase(),
      targetPath,
      source: { kind: 'local', path: absoluteSource },
    };
  }

  if (!sourceStat.isDirectory()) {
    throw new Error(`Local extension source must be a file or directory: ${absoluteSource}`);
  }

  const indexPath = join(absoluteSource, 'index.ts');
  try {
    if (!(await stat(indexPath)).isFile()) {
      throw new Error('missing');
    }
  } catch {
    throw new Error(`Extension directory must contain index.ts: ${absoluteSource}`);
  }

  const packageName = nameOverride ?? basename(absoluteSource);
  const safeName = sanitizeName(packageName);
  const targetPath = join(extensionsRoot, safeName);
  await rmQuiet(targetPath);
  await cp(absoluteSource, targetPath, { recursive: true, force: true });
  return {
    extensionId: safeName.toLowerCase(),
    targetPath,
    source: { kind: 'local', path: absoluteSource },
  };
}

async function installExtensionFromGit(
  extensionsRoot: string,
  source: Extract<InstallSource, { kind: 'git' }>,
  nameOverride?: string,
): Promise<InstallExtensionResult> {
  const tempName = `.tmp-git-ext-${Date.now().toString(36)}`;
  const clonePath = join(extensionsRoot, tempName);
  const args = ['clone', '--depth', '1'];
  if (source.ref) {
    args.push('--branch', source.ref);
  }
  args.push(source.url, clonePath);
  try {
    await execFileAsync('git', args, { timeout: 120_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`git clone failed: ${message}`);
  }

  let contentRoot: string;
  try {
    contentRoot = resolveCloneContentRoot(clonePath, source.subdir);
    const result = await installExtensionFromLocal(extensionsRoot, contentRoot, nameOverride);
    await rmQuiet(clonePath);
    const resultSource: InstallSource = { kind: 'git', url: source.url };
    if (source.ref) resultSource.ref = source.ref;
    if (source.subdir) resultSource.subdir = source.subdir;
    return { ...result, source: resultSource };
  } catch (error) {
    await rmQuiet(clonePath);
    throw error;
  }
}

function sanitizeName(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned : 'extension';
}

async function rmQuiet(pathValue: string): Promise<void> {
  try {
    const { rm } = await import('node:fs/promises');
    await rm(pathValue, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
