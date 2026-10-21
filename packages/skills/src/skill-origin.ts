/** Reads and writes the install-origin record kept next to a git-installed skill. */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SKILL_ORIGIN_FILE, type SkillInstallOrigin } from '@piwin/contracts';

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Undefined when the folder has no (valid) origin record — e.g. a hand-copied skill. */
export async function readSkillOrigin(skillDirectory: string): Promise<SkillInstallOrigin | undefined> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(skillDirectory, SKILL_ORIGIN_FILE), 'utf8'));
  } catch {
    // Missing or corrupt record: the skill simply has no known origin.
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  const url = optionalString(record, 'url');
  if (record.kind !== 'git' || !url) return undefined;
  const subdir = optionalString(record, 'subdir');
  const ref = optionalString(record, 'ref');
  const commit = optionalString(record, 'commit');
  return {
    kind: 'git',
    url,
    ...(subdir ? { subdir } : {}),
    ...(ref ? { ref } : {}),
    ...(commit ? { commit } : {}),
    installedAt: optionalString(record, 'installedAt') ?? '',
  };
}

export async function writeSkillOrigin(
  skillDirectory: string,
  origin: SkillInstallOrigin,
): Promise<void> {
  await writeFile(join(skillDirectory, SKILL_ORIGIN_FILE), `${JSON.stringify(origin, null, 2)}\n`, 'utf8');
}
