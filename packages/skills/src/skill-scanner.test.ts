import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanSkills } from './skill-scanner.js';

describe('scanSkills', () => {
  it('finds SKILL.md under user skills dir', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-skills-'));
    const skillDir = join(rootDir, 'skills', 'demo-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---\nname: demo-skill\ndescription: Demo skill for tests\n---\n\n# Demo\n`,
      'utf8',
    );
    const skills = await scanSkills({ piwinRoot: rootDir });
    expect(skills.some((skill) => skill.id === 'demo-skill')).toBe(true);
  });

  it('discovers the bundled generate-flashcards skill', async () => {
    // Bundled skills live in <repo-root>/skills/<name>/SKILL.md.
    const here = dirname(fileURLToPath(import.meta.url));
    const repoSkillsRoot = resolve(here, '..', '..', '..', 'skills');
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-skills-bundled-'));
    try {
      const skills = await scanSkills({ piwinRoot: rootDir, bundledRoot: repoSkillsRoot });
      const generate = skills.find((skill) => skill.id === 'generate-flashcards');
      expect(generate).toBeTruthy();
      expect(generate?.source).toBe('bundled');
      expect(generate?.name).toBe('generate-flashcards');
    } finally {
      const { rm } = await import('node:fs/promises');
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('generate-flashcards SKILL.md mentions flashcard_batch_create and source attribution', async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const skillPath = resolve(here, '..', '..', '..', 'skills', 'generate-flashcards', 'SKILL.md');
    const content = await readFile(skillPath, 'utf8');
    expect(content).toContain('flashcard_batch_create');
    expect(content).toContain('sourceFolder');
    expect(content).toContain('sourceFile');
    expect(content).toContain('sourceLine');
    expect(content).toContain('sourceExcerpt');
    expect(content).toContain('doccards/');
  });

  it('discovers the bundled writing-plans skill', async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoSkillsRoot = resolve(here, '..', '..', '..', 'skills');
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-skills-writing-plans-'));
    try {
      const skills = await scanSkills({ piwinRoot: rootDir, bundledRoot: repoSkillsRoot });
      const writingPlans = skills.find((skill) => skill.id === 'writing-plans');
      expect(writingPlans).toBeTruthy();
      expect(writingPlans?.source).toBe('bundled');
      expect(writingPlans?.name).toBe('writing-plans');
    } finally {
      const { rm } = await import('node:fs/promises');
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('writing-plans SKILL.md documents the piwin plan artifact protocol', async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const skillPath = resolve(here, '..', '..', '..', 'skills', 'writing-plans', 'SKILL.md');
    const content = await readFile(skillPath, 'utf8');
    expect(content).toContain('writing-plans');
    expect(content).toContain('write-plan');
    expect(content).toContain("skillId: 'writing-plans'");
    expect(content).toContain('subagent-driven');
    expect(content).toContain('inline');
    expect(content).toContain('independentSteps');
    expect(content).toContain('Walkthrough');
  });
});
