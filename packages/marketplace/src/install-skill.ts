import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { InstallSource } from '@piwin/contracts';
import { resolveCloneContentRoot } from './clone-content-root.js';

const execFileAsync = promisify(execFile);

export type InstallSkillResult = {
  skillId: string;
  targetPath: string;
  source: InstallSource;
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
 * - git: shallow clone then optional subdir copy
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
  } catch (error) {
    await rmQuiet(clonePath);
    throw error;
  }
  try {
    await assertHasSkillMarkdown(contentRoot);
  } catch (error) {
    await rmQuiet(clonePath);
    throw error;
  }

  const skillName =
    nameOverride ??
    (source.subdir ? basename(source.subdir) : basename(source.url).replace(/\.git$/, ''));
  const targetPath = join(skillsRoot, sanitizeName(skillName));
  // Move content into final destination
  await rmQuiet(targetPath);
  await cp(contentRoot, targetPath, { recursive: true, force: true });
  await rmQuiet(clonePath);

  const resultSource: InstallSource = { kind: 'git', url: source.url };
  if (source.ref) {
    resultSource.ref = source.ref;
  }
  if (source.subdir) {
    resultSource.subdir = source.subdir;
  }
  return {
    skillId: sanitizeName(skillName).toLowerCase(),
    targetPath,
    source: resultSource,
  };
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
