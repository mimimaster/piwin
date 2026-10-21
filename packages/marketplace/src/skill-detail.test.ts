import { describe, expect, it, vi } from 'vitest';
import { pickSkillMarkdownPath, readSkillDetail } from './skill-detail.js';
import { fetchPackageDetail } from './package-detail.js';

const TREE = {
  tree: [
    { path: 'README.md', type: 'blob' },
    { path: 'skills/pdf/SKILL.md', type: 'blob' },
    { path: 'skills/docx/SKILL.md', type: 'blob' },
    { path: 'node_modules/x/SKILL.md', type: 'blob' },
    { path: 'a/b/c/d/e/SKILL.md', type: 'blob' },
  ],
};
const SKILL_MD = '---\nname: pdf\ndescription: Read and fill PDF forms.\n---\n\n# PDF\n\nBody.\n';

describe('pickSkillMarkdownPath', () => {
  it('matches the skill folder name, skipping vendored and too-deep paths', () => {
    const paths = TREE.tree.map((item) => item.path);
    expect(pickSkillMarkdownPath(paths, 'PDF')).toBe('skills/pdf/SKILL.md');
    expect(pickSkillMarkdownPath(paths, 'xlsx')).toBeUndefined();
    expect(pickSkillMarkdownPath(['tools/SKILL.md'], 'anything')).toBe('tools/SKILL.md');
  });
});

describe('readSkillDetail', () => {
  it('locates SKILL.md through the tree listing and returns body + description', async () => {
    const fetchText = vi.fn(async (url: string) =>
      url.includes('/git/trees/') ? JSON.stringify(TREE) : SKILL_MD,
    );
    const detail = await readSkillDetail('acme/skills', { name: 'pdf' }, fetchText);
    expect(fetchText.mock.calls[1]?.[0]).toBe(
      'https://raw.githubusercontent.com/acme/skills/HEAD/skills/pdf/SKILL.md',
    );
    expect(detail).toEqual({ readme: '# PDF\n\nBody.', description: 'Read and fill PDF forms.' });
  });

  it('reads a known subdir at its pinned ref without listing the tree', async () => {
    const fetchText = vi.fn(async (_url: string, _accept: string) => SKILL_MD);
    await readSkillDetail('acme/skills', { name: 'pdf', subdir: 'skills/pdf', ref: 'abc123' }, fetchText);
    expect(fetchText).toHaveBeenCalledTimes(1);
    expect(fetchText.mock.calls[0]?.[0]).toBe(
      'https://raw.githubusercontent.com/acme/skills/abc123/skills/pdf/SKILL.md',
    );
  });

  it('refuses a traversal subdir', async () => {
    const fetchText = vi.fn(async (_url: string, _accept: string) => SKILL_MD);
    expect(await readSkillDetail('acme/skills', { name: 'x', subdir: '../etc' }, fetchText)).toEqual({});
    expect(fetchText).not.toHaveBeenCalled();
  });
});

describe('fetchPackageDetail for skills', () => {
  it('prefers SKILL.md and still fills license from the repository', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      const text = url.includes('/git/trees/')
        ? JSON.stringify(TREE)
        : url.includes('raw.githubusercontent.com')
          ? SKILL_MD
          : url.endsWith('/readme')
            ? '# Collection README'
            : JSON.stringify({ license: { spdx_id: 'MIT' }, pushed_at: '2026-10-01T00:00:00Z' });
      return {
        ok: true,
        text: async () => text,
        json: async () => JSON.parse(text) as unknown,
      } as unknown as Response;
    });
    const detail = await fetchPackageDetail({
      entryId: 'skills.sh:acme/skills/pdf',
      repositoryUrl: 'https://github.com/acme/skills',
      skill: { name: 'pdf' },
      fetch: fetchFn as unknown as typeof fetch,
    });
    expect(detail).toMatchObject({
      readme: '# PDF\n\nBody.',
      description: 'Read and fill PDF forms.',
      license: 'MIT',
    });
  });
});
