import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureBundledSkillsInstalled } from './ensure-bundled.js';

describe('ensureBundledSkillsInstalled', () => {
  it('does not copy product skills into the user skills directory', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-ensure-bundled-noop-'));
    const bundledRoot = join(piwinRoot, 'bundled-src');
    const skillDir = join(bundledRoot, 'demo-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: demo-skill\ndescription: Demo\nversion: 2\n---\n# Demo\n',
      'utf8',
    );

    const installed = await ensureBundledSkillsInstalled(piwinRoot, bundledRoot);
    expect(installed).toEqual([]);
    await expect(readdir(join(piwinRoot, 'skills'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
