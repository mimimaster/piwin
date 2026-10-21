import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { InstallSource } from '@piwin/contracts';
import { normalizeRepositorySubdir } from '@piwin/contracts';
import { locateSkillDirectory } from './locate-skill-directory.js';
import { writeSkillOrigin } from './skill-origin.js';

const execFileAsync = promisify(execFile);

export type InstallSkillResult = {
  skillId: string;
  targetPath: string;
  source: InstallSource;
  /** Commit installed, for git sources. */
  commit?: string;
};

export type InstallSkillOptions = {
  piwinRoot: string;
  source: InstallSource;
  /** Override destination folder name under ~/.piwin/skills */
  name?: string;
};

/**
 * Install a skill into ~/.piwin/skills/<name>.
 * - local: copy directory (must contain SKILL.md)
 * - git: shallow clone, then copy the skill folder (`subdir`, or located by
 *   `name` inside a multi-skill repo)
 */
export async function installSkill(options: InstallSkillOptions): Promise<InstallSkillResult> {
  const skillsRoot = join(options.piwinRoot, 'skills');
  await mkdir(skillsRoot, { recursive: true });

  if (options.source.kind === 'local') {
    return installFromLocal(skillsRoot, options.source.path, options.name);
  }
  return installFromGit(skillsRoot, options.source, options.name);
}

async function installFromLocal(
  skillsRoot: string,
  sourcePath: string,
  nameOverride?: string,
): Promise<InstallSkillResult> {
  const absoluteSource = resolve(sourcePath);
  const sourceStat = await stat(absoluteSource);
  if (!sourceStat.isDirectory()) {
    throw new Error(`Local skill source must be a directory: ${absoluteSource}`);
  }
  await assertHasSkillMarkdown(absoluteSource);
  const skillName = nameOverride ?? basename(absoluteSource);
  const targetPath = join(skillsRoot, sanitizeName(skillName));
  await cp(absoluteSource, targetPath, { recursive: true, force: true });
  return {
    skillId: sanitizeName(skillName).toLowerCase(),
    targetPath,
    source: { kind: 'local', path: absoluteSource },
  };
}

async function installFromGit(
  skillsRoot: string,
  source: Extract<InstallSource, { kind: 'git' }>,
  nameOverride?: string,
): Promise<InstallSkillResult> {
  const tempName = `.tmp-git-${Date.now().toString(36)}`;
  const clonePath = join(skillsRoot, tempName);
  try {
    for (const args of gitFetchCommands(source, clonePath)) {
      await execFileAsync('git', args, { timeout: 120_000 });
    }
  } catch (error) {
    await rmQuiet(clonePath);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`git clone failed: ${message}`);
  }

  let contentRoot: string;
  try {
    const requestedRoot = resolve(clonePath, normalizeRepositorySubdir(source.subdir));
    contentRoot = await locateSkillDirectory(requestedRoot, nameOverride);
  } catch (error) {
    await rmQuiet(clonePath);
    throw error;
  }

  const locatedSubdir = relative(clonePath, contentRoot).split(sep).join('/');
  const commit = await readCloneCommit(clonePath);
  const skillName =
    nameOverride ??
    (locatedSubdir ? basename(contentRoot) : basename(source.url).replace(/\.git$/, ''));
  const targetPath = join(skillsRoot, sanitizeName(skillName));
  // Only the skill folder is installed, never the rest of a multi-skill repo.
  await rmQuiet(targetPath);
  await cp(contentRoot, targetPath, { recursive: true, force: true });
  await rmQuiet(clonePath);
  // A single-skill repo root was cloned with its .git; the installed copy is not a checkout.
  await rmQuiet(join(targetPath, '.git'));

  const resultSource: Extract<InstallSource, { kind: 'git' }> = { kind: 'git', url: source.url };
  if (source.ref) {
    resultSource.ref = source.ref;
  }
  if (locatedSubdir) {
    resultSource.subdir = locatedSubdir;
  }
  await writeSkillOrigin(targetPath, {
    ...resultSource,
    ...(commit ? { commit } : {}),
    installedAt: new Date().toISOString(),
  });
  return {
    skillId: sanitizeName(skillName).toLowerCase(),
    targetPath,
    source: resultSource,
    ...(commit ? { commit } : {}),
  };
}

const GIT_COMMIT = /^[0-9a-f]{40}$/;

async function readCloneCommit(clonePath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', clonePath, 'rev-parse', 'HEAD'], {
      timeout: 10_000,
    });
    const commit = stdout.trim();
    return GIT_COMMIT.test(commit) ? commit : undefined;
  } catch {
    // The commit only feeds update checks; an install without it still works.
    return undefined;
  }
}

/**
 * `clone --branch` only accepts branches and tags. A pinned commit is fetched
 * directly (GitHub serves any reachable commit) so curated installs get
 * exactly the reviewed tree.
 */
export function gitFetchCommands(
  source: Extract<InstallSource, { kind: 'git' }>,
  clonePath: string,
): string[][] {
  if (source.ref && GIT_COMMIT.test(source.ref)) {
    return [
      ['init', '--quiet', clonePath],
      ['-C', clonePath, 'fetch', '--quiet', '--depth', '1', source.url, source.ref],
      ['-C', clonePath, 'checkout', '--quiet', '--detach', 'FETCH_HEAD'],
    ];
  }
  const clone = ['clone', '--depth', '1'];
  if (source.ref) {
    clone.push('--branch', source.ref);
  }
  clone.push(source.url, clonePath);
  return [clone];
}

async function assertHasSkillMarkdown(directoryPath: string): Promise<void> {
  const skillFile = join(directoryPath, 'SKILL.md');
  try {
    const fileStat = await stat(skillFile);
    if (!fileStat.isFile()) {
      throw new Error('not a file');
    }
  } catch {
    // Also accept a single-level nested skill folder with SKILL.md
    try {
      const entries = await readdir(directoryPath);
      for (const entry of entries) {
        const nested = join(directoryPath, entry, 'SKILL.md');
        try {
          const nestedStat = await stat(nested);
          if (nestedStat.isFile()) {
            return;
          }
        } catch {
          // continue
        }
      }
    } catch {
      // fall through
    }
    throw new Error(`No SKILL.md found under ${directoryPath}`);
  }
}

function sanitizeName(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned : 'skill';
}

async function rmQuiet(pathValue: string): Promise<void> {
  try {
    const { rm } = await import('node:fs/promises');
    await rm(pathValue, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
