import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canUninstallSkill, type SkillSummary } from '@piwin/contracts';

export class SkillUninstallError extends Error {
  readonly name = 'SkillUninstallError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * Remove a user-installed skill directory. Bundled / project / mapped / Pi
 * skills are refused — they are not owned by ~/.piwin/skills.
 */
export async function uninstallUserSkill(options: {
  piwinRoot: string;
  skill: SkillSummary;
}): Promise<{ skillId: string }> {
  if (!canUninstallSkill(options.skill.source)) {
    throw new SkillUninstallError('Bundled skills cannot be uninstalled');
  }
  const userRoot = resolve(options.piwinRoot, 'skills');
  const skillPath = resolve(options.skill.path);
  if (skillPath !== userRoot && !skillPath.startsWith(userRoot + '/') && !skillPath.startsWith(userRoot + '\\')) {
    throw new SkillUninstallError('Skill is outside the user skills directory');
  }
  await rm(skillPath, { recursive: true, force: true });
  return { skillId: options.skill.id };
}
