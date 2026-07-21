import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
