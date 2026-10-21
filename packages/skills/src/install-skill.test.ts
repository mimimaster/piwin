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

describe('installSkill git multi-skill repo', () => {
  async function makeCollectionRepo(): Promise<{ root: string; repo: string }> {
    const root = await mkdtemp(join(tmpdir(), 'piwin-mkt-collection-'));
    const repo = join(root, 'repo');
    const write = async (dir: string, frontmatterName: string) => {
      await mkdir(join(repo, dir), { recursive: true });
      await writeFile(
        join(repo, dir, 'SKILL.md'),
        `---\nname: ${frontmatterName}\n---\n${dir}\n`,
        'utf8',
      );
    };
    await write('skills/pdf', 'pdf');
    await write('skills/docx', 'docx');
    await write('plugins/office/skills/sheet-tools', 'xlsx');
    await writeFile(join(repo, 'README.md'), 'collection\n', 'utf8');
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args]);
    execFileSync('git', ['init', '--quiet', repo]);
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    git('add', '.');
    git('commit', '--quiet', '-m', 'init');
    return { root, repo };
  }

  it('installs only the folder whose name matches, recording its subdir', async () => {
    const { root, repo } = await makeCollectionRepo();
    const result = await installSkill({
      piwinRoot: join(root, 'piwin'),
      source: { kind: 'git', url: `file://${repo}` },
      name: 'pdf',
    });
    expect(result.skillId).toBe('pdf');
    expect(result.source).toEqual({ kind: 'git', url: `file://${repo}`, subdir: 'skills/pdf' });
    expect(await readFile(join(result.targetPath, 'SKILL.md'), 'utf8')).toContain('skills/pdf');
    await expect(readFile(join(result.targetPath, 'README.md'), 'utf8')).rejects.toThrow();
  });

  it('matches the SKILL.md name when the folder is named differently', async () => {
    const { root, repo } = await makeCollectionRepo();
    const result = await installSkill({
      piwinRoot: join(root, 'piwin'),
      source: { kind: 'git', url: `file://${repo}` },
      name: 'xlsx',
    });
    expect(result.source).toMatchObject({ subdir: 'plugins/office/skills/sheet-tools' });
  });

  it('lists the available skills when the name matches none', async () => {
    const { root, repo } = await makeCollectionRepo();
    await expect(
      installSkill({
        piwinRoot: join(root, 'piwin'),
        source: { kind: 'git', url: `file://${repo}` },
        name: 'pptx',
      }),
    ).rejects.toThrow(/Skill "pptx" not found in repository; available: .*skills\/pdf/);
  });
});
