import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearOfficialMcpSearchCache } from './mcp-official-registry.js';
import { parseSkillsShEntryId, searchSkillsSh, skillsShEntryId } from './search-skills-sh.js';
import { searchMarketplaceSources } from './search-marketplace.js';

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

const SKILLS_SH_PAYLOAD = {
  skills: [
    { id: 'anthropics/skills/frontend-design', source: 'anthropics/skills', skillId: 'frontend-design', installs: 1013954 },
    { id: 'acme/tools/pdf-ocr', source: 'acme/tools', skillId: 'pdf-ocr', installs: 12 },
    // Non-GitHub sources cannot be cloned and are dropped.
    { id: 'open.feishu.cn/lark-doc', source: 'open.feishu.cn', skillId: 'lark-doc', installs: 9 },
    { id: 'acme/tools/../x', source: 'acme/tools', skillId: '../x' },
  ],
};


beforeEach(() => {
  clearOfficialMcpSearchCache();
});

describe('searchSkillsSh', () => {
  it('maps GitHub-backed results to installable community skill hits', async () => {
    const fetchFn = vi.fn(async (_url: string) => jsonResponse(SKILLS_SH_PAYLOAD));
    const hits = await searchSkillsSh({ query: 'pdf', fetch: fetchFn as unknown as typeof fetch });
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain('skills.sh/api/search?q=pdf');
    expect(hits.map((hit) => hit.entryId)).toEqual([
      'skills.sh:anthropics/skills/frontend-design',
      'skills.sh:acme/tools/pdf-ocr',
    ]);
    expect(hits[1]).toMatchObject({
      name: 'pdf-ocr',
      source: 'skill',
      kind: 'skill',
      curated: false,
      installs: 12,
      skillSource: { kind: 'git', url: 'https://github.com/acme/tools.git' },
      installCommand: 'piwin skill install skills.sh:acme/tools/pdf-ocr',
    });
  });

  it('does not call the index for an empty query', async () => {
    const fetchFn = vi.fn();
    expect(await searchSkillsSh({ query: '  ', fetch: fetchFn as unknown as typeof fetch })).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('round-trips entry ids and rejects malformed ones', () => {
    expect(parseSkillsShEntryId(skillsShEntryId('acme/tools', 'pdf-ocr'))).toEqual({
      ownerRepo: 'acme/tools',
      skillName: 'pdf-ocr',
    });
    expect(parseSkillsShEntryId('skill:pdf')).toBeUndefined();
    expect(parseSkillsShEntryId('skills.sh:acme/pdf')).toBeUndefined();
    expect(parseSkillsShEntryId('skills.sh:acme/tools/..')).toBeUndefined();
  });
});

describe('searchMarketplaceSources skill merge', () => {
  it('lists curated skills first and drops community copies of them', async () => {
    const fetchFn = vi.fn(async (url: string) =>
      String(url).includes('skills.sh')
        ? jsonResponse(SKILLS_SH_PAYLOAD)
        : String(url).includes('registry.npmjs.org')
          ? jsonResponse({ objects: [] })
          : jsonResponse({ items: [], servers: [] }),
    );
    const result = await searchMarketplaceSources({
      query: 'frontend',
      fetch: fetchFn as unknown as typeof fetch,
    });
    const skills = result.hits.filter((hit) => hit.source === 'skill');
    expect(skills.map((hit) => hit.entryId)).toEqual(['skill:frontend-design', 'skills.sh:acme/tools/pdf-ocr']);
    expect(skills[0]).toMatchObject({
      curated: true,
      skillSource: { kind: 'git', subdir: 'skills/frontend-design' },
    });
  });

  it('keeps curated skills and reports the error when skills.sh is down', async () => {
    const fetchFn = vi.fn(async (url: string) =>
      String(url).includes('skills.sh')
        ? ({ ok: false, status: 503 } as unknown as Response)
        : jsonResponse({ objects: [], items: [], servers: [] }),
    );
    const result = await searchMarketplaceSources({
      query: 'frontend',
      fetch: fetchFn as unknown as typeof fetch,
    });
    expect(result.hits.some((hit) => hit.entryId === 'skill:frontend-design')).toBe(true);
    expect(result.remoteError).toContain('skills.sh');
  });
});
