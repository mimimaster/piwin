import { cp, mkdir, readFile, readdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveBundledAssetsRoot } from './bundled-assets-root.js';

const SKILL_FILE_NAME = 'SKILL.md';

/**
 * Parse the `version` frontmatter field from a skill's SKILL.md.
 *
 * Returns null when the file is missing, has no frontmatter, or declares no
 * version. An unversioned skill is treated as "legacy" by the sync below.
 */
async function readSkillVersion(skillDir: string): Promise<string | null> {
  try {
    const raw = await readFile(join(skillDir, SKILL_FILE_NAME), 'utf8');
    const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!frontmatterMatch) return null;
    for (const line of (frontmatterMatch[1] ?? '').split(/\r?\n/)) {
      const separatorIndex = line.indexOf(':');
      if (separatorIndex === -1) continue;
      if (line.slice(0, separatorIndex).trim() !== 'version') continue;
      const value = line
        .slice(separatorIndex + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
      return value || null;
    }
    return null;
  } catch {
    return null;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * True when the bundled copy should overwrite the installed copy.
 *
 * - Bundled skills without a `version` are treated as unmanaged and never
 *   overwrite an existing install (avoids clobbering user edits).
 * - An unversioned installed copy is treated as a legacy bundled install and
 *   is upgraded to the current bundled version.
 * - Versioned copies are upgraded only when the bundled version is newer.
 */
function shouldUpgradeSkill(
  bundledVersion: string | null,
  installedVersion: string | null,
): boolean {
  if (bundledVersion === null) return false;
  if (installedVersion === null) return true;
  const isPlainInteger = (value: string): boolean => /^\d+$/.test(value);
  if (isPlainInteger(bundledVersion) && isPlainInteger(installedVersion)) {
    return Number(bundledVersion) > Number(installedVersion);
  }
  return bundledVersion.localeCompare(installedVersion) > 0;
}

/**
 * Preserve the previous installed SKILL.md before a bundled upgrade overwrites
 * it. Timestamped so repeated upgrades never collide.
 */
async function backupSkillFile(skillDir: string): Promise<void> {
  const from = join(skillDir, SKILL_FILE_NAME);
  const to = join(
    skillDir,
    `${SKILL_FILE_NAME}.bak-${Date.now().toString(36)}`,
  );
  try {
    await rename(from, to);
  } catch {
    // Best-effort: an upgrade that loses the backup is still an upgrade.
  }
}

/**
 * Copy shipped skills into ~/.piwin/skills, upgrading stale bundled copies.
 *
 * Missing skills are installed; existing skills are upgraded when the bundled
 * copy declares a newer `version` (see {@link shouldUpgradeSkill}). Upgrades
 * preserve the previous SKILL.md as a timestamped `.bak` file in the same
 * directory; other user files inside the skill directory are left untouched.
 * Returns the names of skills that were installed or upgraded.
 */
export async function ensureBundledSkillsInstalled(
  piwinRoot: string,
  bundledRoot?: string,
): Promise<string[]> {
  const sourceRoot =
    bundledRoot ??
    resolveBundledAssetsRoot({
      layoutPath: 'skills',
      moduleUrl: import.meta.url,
      relativeFallback: '../../../skills',
    });
  const targetRoot = join(piwinRoot, 'skills');
  await mkdir(targetRoot, { recursive: true });
  let entries: string[] = [];
  try {
    entries = await readdir(sourceRoot);
  } catch {
    return [];
  }
  const installed: string[] = [];
  for (const entry of entries) {
    const from = join(sourceRoot, entry);
    const to = join(targetRoot, entry);
    try {
      if (!(await stat(from)).isDirectory()) continue;
      const bundledVersion = await readSkillVersion(from);
      if (!(await pathExists(to))) {
        // Fresh install: copy the bundled skill wholesale.
        await cp(from, to, { recursive: true });
        installed.push(entry);
        continue;
      }
      const installedVersion = await readSkillVersion(to);
      if (!shouldUpgradeSkill(bundledVersion, installedVersion)) {
        continue;
      }
      await backupSkillFile(to);
      await cp(from, to, { recursive: true });
      installed.push(entry);
    } catch {
      /* ignore */
    }
  }
  return installed;
}
