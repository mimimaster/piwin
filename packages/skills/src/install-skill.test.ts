import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { installSkill } from './install-skill.js';

describe('installSkill local', () => {
  it('copies a skill directory into piwin skills root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-mkt-'));
    const sourceDir = join(root, 'my-skill');
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, 'SKILL.md'),
      '---\nname: my-skill\ndescription: test\n---\n\n# My skill\n',
      'utf8',
    );

    const result = await installSkill({
      piwinRoot: root,
      source: { kind: 'local', path: sourceDir },
    });

    expect(result.skillId).toBe('my-skill');
    const installed = await readFile(join(result.targetPath, 'SKILL.md'), 'utf8');
    expect(installed).toContain('name: my-skill');
  });
});

describe('installSkill git', () => {
  it('installs the exact pinned commit, not the branch head', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-mkt-git-'));
    const repo = join(root, 'repo');
    const skillDir = join(repo, 'skills', 'pinned');
    await mkdir(skillDir, { recursive: true });
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
    execFileSync('git', ['init', '--quiet', repo]);
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: pinned\n---\nfirst\n', 'utf8');
    git('add', '.');
    git('commit', '--quiet', '-m', 'first');
    const firstCommit = git('rev-parse', 'HEAD');
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: pinned\n---\nsecond\n', 'utf8');
    git('commit', '--quiet', '-am', 'second');

    const result = await installSkill({
      piwinRoot: join(root, 'piwin'),
      source: { kind: 'git', url: `file://${repo}`, ref: firstCommit, subdir: 'skills/pinned' },
    });

    expect(result.skillId).toBe('pinned');
    expect(await readFile(join(result.targetPath, 'SKILL.md'), 'utf8')).toContain('first');
  });
});
