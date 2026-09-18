import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveSkillDocumentReadPath } from './skill-document-read-path.js';

describe('resolveSkillDocumentReadPath', () => {
  it('rewrites a missing bundled-assets guess onto the project skill file', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'piwin-skill-read-remap-'));
    const skillDir = join(projectRoot, '.agents', 'skills', 'karpathy-guidelines');
    await mkdir(skillDir, { recursive: true });
    const realSkill = join(skillDir, 'SKILL.md');
    await writeFile(realSkill, '---\nname: karpathy-guidelines\ndescription: d\n---\n\n# Body\n', 'utf8');

    const guessed =
      '/Applications/piwinwin.app/Contents/Resources/host/bundled-assets/skills/karpathy-guidelines/SKILL.md';
    const resolved = await resolveSkillDocumentReadPath({
      requestedPath: guessed,
      skills: [{ id: 'karpathy-guidelines', path: skillDir }],
    });
    expect(resolved).toBe(realSkill);
  });

  it('keeps an existing file without consulting the catalog', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-skill-read-keep-'));
    const existing = join(root, 'notes.md');
    await writeFile(existing, '# notes\n', 'utf8');
    const resolved = await resolveSkillDocumentReadPath({
      requestedPath: existing,
      skills: [{ id: 'notes', path: join(root, 'other') }],
    });
    expect(resolved).toBe(existing);
  });
});
