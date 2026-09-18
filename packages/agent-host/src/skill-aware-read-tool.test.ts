import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createSkillAwarePiReadToolDefinition,
  mergeSkillAwareReadTool,
  remapSkillAwareReadPath,
} from './skill-aware-read-tool.js';

describe('remapSkillAwareReadPath', () => {
  it('rewrites a missing packaged bundled-assets guess onto the catalog file', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'piwin-ah-skill-read-'));
    const skillDir = join(projectRoot, '.agents', 'skills', 'karpathy-guidelines');
    await mkdir(skillDir, { recursive: true });
    const realSkill = join(skillDir, 'SKILL.md');
    await writeFile(realSkill, '# guidelines\n', 'utf8');

    const resolved = await remapSkillAwareReadPath(
      '/Applications/piwinwin.app/Contents/Resources/host/bundled-assets/skills/karpathy-guidelines/SKILL.md',
      [{ resourceId: 'karpathy-guidelines', path: skillDir }],
    );
    expect(resolved).toBe(realSkill);
  });
});

describe('mergeSkillAwareReadTool', () => {
  it('appends a Pi read definition when the factory exists', async () => {
    const createReadToolDefinition = vi.fn((_cwd: string, options: { operations: unknown }) => ({
      name: 'read',
      operations: options.operations,
    }));
    const merged = await mergeSkillAwareReadTool([{ name: 'bash' }], {
      cwd: '/tmp/work',
      skills: [{ resourceId: 'karpathy-guidelines', path: '/repo/.agents/skills/karpathy-guidelines' }],
      piModule: { createReadToolDefinition },
    });
    expect(merged).toHaveLength(2);
    expect(createReadToolDefinition).toHaveBeenCalledOnce();
  });

  it('leaves custom tools unchanged when Pi has no read factory', async () => {
    const existing = [{ name: 'bash' }];
    const merged = await mergeSkillAwareReadTool(existing, {
      cwd: '/tmp/work',
      skills: [],
      piModule: {},
    });
    expect(merged).toBe(existing);
  });
});

describe('createSkillAwarePiReadToolDefinition', () => {
  it('returns null without a Pi factory', async () => {
    await expect(
      createSkillAwarePiReadToolDefinition({
        cwd: '/tmp',
        skills: [],
        piModule: {},
      }),
    ).resolves.toBeNull();
  });
});
