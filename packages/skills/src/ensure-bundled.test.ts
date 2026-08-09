import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureBundledSkillsInstalled } from './ensure-bundled.js';

function skillMarkdown(version: string | null, extra = ''): string {
  const versionLine = version === null ? '' : `version: ${version}\n`;
  return `---\nname: demo-skill\ndescription: Demo skill\n${versionLine}---\n\n# Demo\n${extra}`;
}

async function writeBundledSkill(bundledRoot: string, version: string | null, extra = ''): Promise<void> {
  const skillDir = join(bundledRoot, 'demo-skill');
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), skillMarkdown(version, extra), 'utf8');
}

describe('ensureBundledSkillsInstalled', () => {
  it('installs a missing bundled skill', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-ensure-bundled-install-'));
    const bundledRoot = join(piwinRoot, 'bundled-src');
    await writeBundledSkill(bundledRoot, '2');

    const installed = await ensureBundledSkillsInstalled(piwinRoot, bundledRoot);
    expect(installed).toEqual(['demo-skill']);
    const content = await readFile(join(piwinRoot, 'skills', 'demo-skill', 'SKILL.md'), 'utf8');
    expect(content).toContain('version: 2');
  });

  it('upgrades a stale unversioned install and backs up the previous file', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-ensure-bundled-upgrade-'));
    const bundledRoot = join(piwinRoot, 'bundled-src');
    await writeBundledSkill(bundledRoot, '2', 'bundled body');
    // Legacy install: no version frontmatter.
    const installedDir = join(piwinRoot, 'skills', 'demo-skill');
    await mkdir(installedDir, { recursive: true });
    await writeFile(join(installedDir, 'SKILL.md'), skillMarkdown(null, 'legacy body'), 'utf8');

    const installed = await ensureBundledSkillsInstalled(piwinRoot, bundledRoot);
    expect(installed).toEqual(['demo-skill']);
    const content = await readFile(join(installedDir, 'SKILL.md'), 'utf8');
    expect(content).toContain('version: 2');
    expect(content).toContain('bundled body');
    const files = await readdir(installedDir);
    expect(files.some((name) => name.startsWith('SKILL.md.bak-'))).toBe(true);
  });

  it('upgrades an older versioned install to the newer bundled version', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-ensure-bundled-versioned-'));
    const bundledRoot = join(piwinRoot, 'bundled-src');
    await writeBundledSkill(bundledRoot, '3', 'bundled body');
    const installedDir = join(piwinRoot, 'skills', 'demo-skill');
    await mkdir(installedDir, { recursive: true });
    await writeFile(join(installedDir, 'SKILL.md'), skillMarkdown('1', 'old body'), 'utf8');

    await ensureBundledSkillsInstalled(piwinRoot, bundledRoot);
    const content = await readFile(join(installedDir, 'SKILL.md'), 'utf8');
    expect(content).toContain('version: 3');
    expect(content).toContain('bundled body');
  });

  it('skips an install that is already at the bundled version', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-ensure-bundled-current-'));
    const bundledRoot = join(piwinRoot, 'bundled-src');
    await writeBundledSkill(bundledRoot, '2', 'bundled body');
    const installedDir = join(piwinRoot, 'skills', 'demo-skill');
    await mkdir(installedDir, { recursive: true });
    await writeFile(join(installedDir, 'SKILL.md'), skillMarkdown('2', 'installed body'), 'utf8');

    const installed = await ensureBundledSkillsInstalled(piwinRoot, bundledRoot);
    expect(installed).toEqual([]);
    // Installed copy untouched: no backup, content preserved.
    const files = await readdir(installedDir);
    expect(files).toEqual(['SKILL.md']);
    const content = await readFile(join(installedDir, 'SKILL.md'), 'utf8');
    expect(content).toContain('installed body');
  });

  it('never overwrites an existing install when the bundled copy is unversioned', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-ensure-bundled-unversioned-'));
    const bundledRoot = join(piwinRoot, 'bundled-src');
    await writeBundledSkill(bundledRoot, null, 'bundled body');
    const installedDir = join(piwinRoot, 'skills', 'demo-skill');
    await mkdir(installedDir, { recursive: true });
    await writeFile(join(installedDir, 'SKILL.md'), skillMarkdown(null, 'user body'), 'utf8');

    const installed = await ensureBundledSkillsInstalled(piwinRoot, bundledRoot);
    expect(installed).toEqual([]);
    const content = await readFile(join(installedDir, 'SKILL.md'), 'utf8');
    expect(content).toContain('user body');
  });

  it('skips an install whose version is newer than the bundled copy', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-ensure-bundled-newer-'));
    const bundledRoot = join(piwinRoot, 'bundled-src');
    await writeBundledSkill(bundledRoot, '2');
    const installedDir = join(piwinRoot, 'skills', 'demo-skill');
    await mkdir(installedDir, { recursive: true });
    await writeFile(join(installedDir, 'SKILL.md'), skillMarkdown('5'), 'utf8');

    const installed = await ensureBundledSkillsInstalled(piwinRoot, bundledRoot);
    expect(installed).toEqual([]);
    const content = await readFile(join(installedDir, 'SKILL.md'), 'utf8');
    expect(content).toContain('version: 5');
  });
});
