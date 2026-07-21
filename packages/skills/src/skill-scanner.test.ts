import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanSkills } from './skill-scanner.js';

describe('scanSkills', () => {
  it('finds SKILL.md under user skills dir', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-skills-'));
    const skillDir = join(rootDir, 'skills', 'demo-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), `---\nname: demo-skill\ndescription: Demo skill for tests\n---\n\n# Demo\n`, 'utf8');
    const skills = await scanSkills({ piwinRoot: rootDir });
    expect(skills.some((skill) => skill.id === 'demo-skill')).toBe(true);
  });
});
