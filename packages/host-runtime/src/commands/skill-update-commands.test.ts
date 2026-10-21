import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SkillUpdateError } from '@piwin/skills';
import { handleSkillUpdateCommand } from './skill-update-commands.js';

async function piwinWithSkill(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'piwin-skill-update-cmd-'));
  await mkdir(join(root, 'skills', 'notes'), { recursive: true });
  await writeFile(join(root, 'skills', 'notes', 'SKILL.md'), '---\nname: notes\n---\nx\n', 'utf8');
  return root;
}

describe('handleSkillUpdateCommand', () => {
  it('ignores other commands', async () => {
    expect(await handleSkillUpdateCommand({ type: 'skills/list' }, '1', {})).toBeNull();
  });

  it('updates a found skill and reports the result', async () => {
    const piwinRoot = await piwinWithSkill();
    const update = vi.fn(async () => ({ skillId: 'notes', commit: 'b', previousCommit: 'a', changed: true }));
    const response = await handleSkillUpdateCommand(
      { type: 'skills/update', skillId: 'notes' },
      '1',
      { piwinRoot },
      update,
    );
    expect(response).toMatchObject({ success: true, data: { changed: true, commit: 'b' } });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ piwinRoot }));
  });

  it('turns refusals and unknown ids into failed responses', async () => {
    const piwinRoot = await piwinWithSkill();
    const refuse = vi.fn(async () => {
      throw new SkillUpdateError('Skill "notes" is pinned; update it from the curated catalog');
    });
    expect(
      await handleSkillUpdateCommand({ type: 'skills/update', skillId: 'notes' }, '1', { piwinRoot }, refuse),
    ).toMatchObject({ success: false, error: expect.stringContaining('pinned') });
    expect(
      await handleSkillUpdateCommand({ type: 'skills/update', skillId: 'nope' }, '1', { piwinRoot }, refuse),
    ).toMatchObject({ success: false, error: 'Skill not found: nope' });
  });
});
