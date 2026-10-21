import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { SKILL_ORIGIN_FILE } from '@piwin/contracts';
import { installSkill } from './install-skill.js';
import { scanSkills } from './skill-scanner.js';
import { SkillUpdateError, updateSkillFromOrigin } from './update-skill.js';

async function makeRepo(): Promise<{ root: string; repo: string; commit: (text: string) => string }> {
  const root = await mkdtemp(join(tmpdir(), 'piwin-skill-update-'));
  const repo = join(root, 'repo');
  await mkdir(join(repo, 'skills', 'notes'), { recursive: true });
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  execFileSync('git', ['init', '--quiet', repo]);
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  const commit = (text: string) => {
    execFileSync('sh', ['-c', `printf -- '---\\nname: notes\\n---\\n${text}\\n' > "${join(repo, 'skills', 'notes', 'SKILL.md')}"`]);
    git('add', '.');
    git('commit', '--quiet', '-m', text);
    return git('rev-parse', 'HEAD');
  };
  return { root, repo, commit };
}

describe('skill install origin and update', () => {
  it('records the origin, exposes it to the scanner, and updates to the new commit', async () => {
    const { root, repo, commit } = await makeRepo();
    const first = commit('v1');
    const piwinRoot = join(root, 'piwin');
    const installed = await installSkill({
      piwinRoot,
      source: { kind: 'git', url: `file://${repo}` },
      name: 'notes',
    });
    expect(installed.commit).toBe(first);
    const origin = JSON.parse(await readFile(join(installed.targetPath, SKILL_ORIGIN_FILE), 'utf8'));
    expect(origin).toMatchObject({ kind: 'git', url: `file://${repo}`, subdir: 'skills/notes', commit: first });

    const [skill] = await scanSkills({ piwinRoot, projectPath: root });
    expect(skill?.origin?.commit).toBe(first);
    if (!skill) throw new Error('skill not scanned');

    const unchanged = await updateSkillFromOrigin({ piwinRoot, skill });
    expect(unchanged).toMatchObject({ changed: false, commit: first });

    const second = commit('v2');
    const updated = await updateSkillFromOrigin({ piwinRoot, skill });
    expect(updated).toMatchObject({ changed: true, previousCommit: first, commit: second });
    expect(await readFile(join(installed.targetPath, 'SKILL.md'), 'utf8')).toContain('v2');
  });

  it('refuses pinned installs and skills without an origin', async () => {
    const { root, repo, commit } = await makeRepo();
    const pinned = commit('v1');
    const piwinRoot = join(root, 'piwin');
    await installSkill({ piwinRoot, source: { kind: 'git', url: `file://${repo}`, ref: pinned }, name: 'notes' });
    const handMade = join(piwinRoot, 'skills', 'hand');
    await mkdir(handMade, { recursive: true });
    await writeFile(join(handMade, 'SKILL.md'), '---\nname: hand\n---\nx\n', 'utf8');
    const skills = await scanSkills({ piwinRoot, projectPath: root });
    for (const skill of skills) {
      await expect(updateSkillFromOrigin({ piwinRoot, skill })).rejects.toBeInstanceOf(SkillUpdateError);
    }
    expect(skills.find((skill) => skill.id === 'hand')?.origin).toBeUndefined();
  });
});
