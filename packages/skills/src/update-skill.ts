/**
 * Re-installs a git-installed skill from its recorded origin at the source's
 * latest commit. Pinned (curated) installs are refused: the catalog moves
 * those, so a reviewed pin never drifts to unreviewed code.
 */
import { basename, resolve } from 'node:path';
import { isPinnedSkillOrigin, type SkillSummary } from '@piwin/contracts';
import { installSkill } from './install-skill.js';
import { readSkillOrigin } from './skill-origin.js';

export class SkillUpdateError extends Error {
  override readonly name = 'SkillUpdateError';
}

export type UpdateSkillResult = {
  skillId: string;
  previousCommit?: string;
  commit?: string;
  changed: boolean;
};

export async function updateSkillFromOrigin(options: {
  piwinRoot: string;
  skill: SkillSummary;
  /** Injected for tests; defaults to the real git installer. */
  install?: typeof installSkill;
}): Promise<UpdateSkillResult> {
  const userRoot = resolve(options.piwinRoot, 'skills');
  const skillPath = resolve(options.skill.path);
  if (!skillPath.startsWith(userRoot + '/') && !skillPath.startsWith(userRoot + '\\')) {
    throw new SkillUpdateError('Only skills installed under the piwin skills directory can be updated');
  }
  const origin = await readSkillOrigin(skillPath);
  if (!origin) {
    throw new SkillUpdateError(`Skill "${options.skill.id}" has no recorded git source`);
  }
  if (isPinnedSkillOrigin(origin)) {
    throw new SkillUpdateError(`Skill "${options.skill.id}" is pinned; update it from the curated catalog`);
  }
  const result = await (options.install ?? installSkill)({
    piwinRoot: options.piwinRoot,
    source: {
      kind: 'git',
      url: origin.url,
      ...(origin.ref ? { ref: origin.ref } : {}),
      ...(origin.subdir ? { subdir: origin.subdir } : {}),
    },
    // Same folder, so the skill keeps its id and enabled state.
    name: basename(skillPath),
  });
  return {
    skillId: options.skill.id,
    ...(origin.commit ? { previousCommit: origin.commit } : {}),
    ...(result.commit ? { commit: result.commit } : {}),
    changed: !origin.commit || !result.commit || origin.commit !== result.commit,
  };
}
