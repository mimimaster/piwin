import { describe, expect, it } from 'vitest';
import {
  catalogSkillMarkdownPathForRead,
  extractSkillIdFromDocumentPath,
  skillMarkdownPathFromCatalogPath,
} from './skill-document-path.js';

describe('extractSkillIdFromDocumentPath', () => {
  it('reads bundled-assets SKILL.md paths from a packaged Host', () => {
    expect(
      extractSkillIdFromDocumentPath(
        '/Applications/piwinwin.app/Contents/Resources/host/bundled-assets/skills/karpathy-guidelines/SKILL.md',
      ),
    ).toBe('karpathy-guidelines');
  });

  it('reads project-local .agents skill paths', () => {
    expect(
      extractSkillIdFromDocumentPath(
        '/Users/me/work/.agents/skills/karpathy-guidelines/SKILL.md',
      ),
    ).toBe('karpathy-guidelines');
  });
});

describe('skillMarkdownPathFromCatalogPath', () => {
  it('appends SKILL.md to a catalog directory', () => {
    expect(skillMarkdownPathFromCatalogPath('/repo/.agents/skills/karpathy-guidelines')).toBe(
      '/repo/.agents/skills/karpathy-guidelines/SKILL.md',
    );
  });

  it('keeps an explicit markdown path', () => {
    expect(skillMarkdownPathFromCatalogPath('/repo/skills/demo.md')).toBe('/repo/skills/demo.md');
  });
});

describe('catalogSkillMarkdownPathForRead', () => {
  it('maps a bundled-assets guess onto the catalog skill directory', () => {
    expect(
      catalogSkillMarkdownPathForRead({
        requestedPath:
          '/Applications/piwinwin.app/Contents/Resources/host/bundled-assets/skills/karpathy-guidelines/SKILL.md',
        skills: [{ resourceId: 'karpathy-guidelines', path: '/repo/.agents/skills/karpathy-guidelines' }],
      }),
    ).toBe('/repo/.agents/skills/karpathy-guidelines/SKILL.md');
  });
});
