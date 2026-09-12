import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SkillSummary } from '@piwin/contracts';
import { uninstallUserSkill } from './uninstall-user-skill.js';

function skill(partial: Partial<SkillSummary> & Pick<SkillSummary, 'id' | 'path' | 'source'>): SkillSummary {
  return {
    name: partial.name ?? partial.id,
    description: partial.description ?? 'd',
    enabled: partial.enabled ?? true,
    ...partial,
  };
}

describe('uninstallUserSkill', () => {
  it('refuses bundled skills', async () => {
    await expect(
      uninstallUserSkill({
        piwinRoot: '/tmp/piwin',
        skill: skill({
          id: 'writing-plans',
          path: '/repo/skills/writing-plans',
          source: 'bundled',
        }),
      }),
    ).rejects.toThrow('Bundled skills cannot be uninstalled');
  });

  it('removes a user-installed skill directory', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-uninstall-skill-'));
    const skillDir = join(piwinRoot, 'skills', 'my-notes');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: my-notes\n---\n# Notes\n', 'utf8');

    const result = await uninstallUserSkill({
      piwinRoot,
      skill: skill({ id: 'my-notes', path: skillDir, source: 'user' }),
    });
    expect(result.skillId).toBe('my-notes');
    await expect(readFile(join(skillDir, 'SKILL.md'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
