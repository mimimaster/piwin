import { describe, expect, it } from 'vitest';
import { buildSlashCatalog, SKILL_SLASH_ALIASES } from './slash-catalog';
import { filterSlashItems } from './slash-match';

const skills = [
  { id: 'writing-plans', name: 'writing-plans', description: 'Plan', enabled: true },
  { id: 'create-skill', name: 'create-skill', enabled: true },
];

describe('buildSlashCatalog — write-plan alias', () => {
  it('registers write-plan as an alias of writing-plans', () => {
    expect(SKILL_SLASH_ALIASES['write-plan']).toBe('writing-plans');
    const catalog = buildSlashCatalog({
      skills,
      hasActiveSession: true,
      projectTrusted: true,
    });
    const item = catalog.find((entry) => entry.id === 'skill:writing-plans');
    expect(item).toBeTruthy();
    expect(item?.aliases).toContain('write-plan');
  });

  it('autocomplete matches /write-plan query to writing-plans skill', () => {
    const catalog = buildSlashCatalog({
      skills,
      hasActiveSession: true,
      projectTrusted: true,
    });
    const filtered = filterSlashItems(catalog, 'write-plan');
    expect(filtered.some((entry) => entry.id === 'skill:writing-plans')).toBe(true);
  });

  it('autocomplete matches /writing-plans query to writing-plans skill', () => {
    const catalog = buildSlashCatalog({
      skills,
      hasActiveSession: true,
      projectTrusted: true,
    });
    const filtered = filterSlashItems(catalog, 'writing-plans');
    expect(filtered.some((entry) => entry.id === 'skill:writing-plans')).toBe(true);
  });
});

describe('buildSlashCatalog — Conversation chat', () => {
  it('keeps compact/stop and omits modes, skills, and orchestration', () => {
    const catalog = buildSlashCatalog({
      skills,
      hasActiveSession: true,
      projectTrusted: true,
      conversationChat: true,
    });
    expect(catalog.map((item) => item.id)).toEqual(['cmd:compact', 'cmd:stop']);
    expect(catalog.some((item) => item.kind === 'mode')).toBe(false);
    expect(catalog.some((item) => item.kind === 'skill')).toBe(false);
  });
});
