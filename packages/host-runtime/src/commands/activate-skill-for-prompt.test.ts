import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { formatSkillPrompt } from '@piwin/contracts';
import { activateSkillForPrompt } from './activate-skill-for-prompt.js';

const tempRoots: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function writeUserSkill(
  piwinRoot: string,
  name: string,
  body: string,
): Promise<void> {
  const skillDir = join(piwinRoot, 'skills', name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: test skill\n---\n\n${body}\n`,
    'utf8',
  );
}

describe('activateSkillForPrompt', () => {
  it('injects SKILL.md body for an explicit skillId', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-skill-activate-'));
    tempRoots.push(piwinRoot);
    await writeUserSkill(piwinRoot, 'demo-skill', '# Demo\n\nDo the demo steps.');

    const thin = formatSkillPrompt('demo-skill', 'demo-skill', 'run demo');
    const result = await activateSkillForPrompt({
      text: thin,
      skillId: 'demo-skill',
      piwinRoot,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skillBody).toContain('Do the demo steps.');
    expect(result.skillBody).not.toContain('description: test skill');
    expect(result.text).toContain('## Skill instructions');
    expect(result.text).toContain('Do the demo steps.');
    expect(result.text).toContain('## User request');
    expect(result.text).toContain('run demo');
  });

  it('strips a leading /skill token from the user request', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-skill-activate-slash-'));
    tempRoots.push(piwinRoot);
    await writeUserSkill(piwinRoot, 'vanta', '# VANTA\n\nStay in character.');

    const result = await activateSkillForPrompt({
      text: '/vanta who are you',
      skillId: 'vanta',
      piwinRoot,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain('## User request');
    expect(result.text).toContain('who are you');
    expect(result.text).not.toContain('/vanta who are you');
  });

  it('returns unavailable when the skill is missing', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-skill-activate-miss-'));
    tempRoots.push(piwinRoot);
    await mkdir(join(piwinRoot, 'skills'), { recursive: true });

    const result = await activateSkillForPrompt({
      text: formatSkillPrompt('missing', 'missing', 'x'),
      skillId: 'missing',
      piwinRoot,
    });
    expect(result.ok).toBe(false);
  });
});
