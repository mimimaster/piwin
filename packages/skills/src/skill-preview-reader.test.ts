import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractSkillIdFromLegacyPath,
  matchSkillByLegacyPath,
  pickEffectiveSkill,
  readSkillPreview,
} from './skill-preview-reader.js';
import type { SkillSummary } from '@piwin/contracts';

function skill(partial: Partial<SkillSummary> & Pick<SkillSummary, 'id' | 'name' | 'path' | 'source'>): SkillSummary {
  return {
    description: partial.description ?? 'd',
    enabled: partial.enabled ?? true,
    ...partial,
  };
}

describe('extractSkillIdFromLegacyPath', () => {
  it('extracts id from bundle-style SKILL.md path', () => {
    expect(
      extractSkillIdFromLegacyPath(
        '/Applications/piwinwin.app/Contents/Resources/host/skills/executing-plans/SKILL.md',
      ),
    ).toBe('executing-plans');
  });

  it('extracts id from user install path', () => {
    expect(extractSkillIdFromLegacyPath('/Users/me/.piwin/skills/writing-plans/SKILL.md')).toBe(
      'writing-plans',
    );
  });
});

describe('pickEffectiveSkill', () => {
  it('prefers enabled entry when duplicates exist', () => {
    const skills = [
      skill({ id: 'demo', name: 'demo', path: '/a/demo', source: 'user', enabled: false }),
      skill({ id: 'demo', name: 'demo', path: '/b/demo', source: 'project', enabled: true }),
    ];
    expect(pickEffectiveSkill(skills, 'demo')?.path).toBe('/b/demo');
  });
});

describe('matchSkillByLegacyPath', () => {
  it('matches catalog path and falls back to id extraction', () => {
    const skills = [
      skill({
        id: 'executing-plans',
        name: 'executing-plans',
        path: '/Users/me/.piwin/skills/executing-plans',
        source: 'user',
      }),
    ];
    expect(
      matchSkillByLegacyPath(skills, '/Users/me/.piwin/skills/executing-plans/SKILL.md')?.id,
    ).toBe('executing-plans');
    expect(
      matchSkillByLegacyPath(
        skills,
        '/Applications/app/Contents/Resources/host/skills/executing-plans/SKILL.md',
      )?.id,
    ).toBe('executing-plans');
  });
});

describe('readSkillPreview', () => {
  it('reads skill by id from piwinRoot/skills', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-skill-read-'));
    const skillDir = join(piwinRoot, 'skills', 'executing-plans');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: executing-plans\ndescription: run plans\n---\n\n# Executing Plans\n\nBody.\n',
      'utf8',
    );

    const result = await readSkillPreview({
      piwinRoot,
      skillId: 'executing-plans',
    });
    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.skillId).toBe('executing-plans');
      expect(result.content).toContain('# Executing Plans');
      expect(result.provenance).toBe('current-resource');
      expect(result.displayRef).toBe('skill:executing-plans');
    }
  });

  it('maps legacy bundle path to installed skill via id extraction', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-skill-legacy-'));
    const skillDir = join(piwinRoot, 'skills', 'executing-plans');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: executing-plans\ndescription: x\n---\n\n# OK\n',
      'utf8',
    );

    const result = await readSkillPreview({
      piwinRoot,
      legacyPath:
        '/Applications/piwinwin.app/Contents/Resources/host/skills/executing-plans/SKILL.md',
    });
    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.content).toContain('# OK');
    }
  });

  it('rejects paths outside skill catalog roots', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-skill-out-'));
    await mkdir(join(piwinRoot, 'skills'), { recursive: true });
    const result = await readSkillPreview({
      piwinRoot,
      legacyPath: '/etc/passwd',
    });
    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') {
      expect(['skill-unresolved', 'outside-catalog', 'not-found']).toContain(result.reason);
    }
  });

  it('rejects symlink escape from skill directory', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-skill-link-'));
    const skillDir = join(piwinRoot, 'skills', 'escape-skill');
    await mkdir(skillDir, { recursive: true });
    const outside = await mkdtemp(join(tmpdir(), 'piwin-skill-secret-'));
    const secret = join(outside, 'secret.md');
    await writeFile(secret, 'leak\n', 'utf8');
    // Skill scanner needs SKILL.md — point it at outside via symlink
    await symlink(secret, join(skillDir, 'SKILL.md'));

    const result = await readSkillPreview({
      piwinRoot,
      skillId: 'escape-skill',
    });
    // Symlink target outside authorized roots → outside-catalog
    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') {
      expect(result.reason).toBe('outside-catalog');
    }
  });
});
