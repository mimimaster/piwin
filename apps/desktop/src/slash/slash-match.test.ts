import { describe, expect, it } from 'vitest';
import { buildSlashCatalog } from './slash-catalog';
import { filterSlashItems, groupSlashItems } from './slash-match';

function catalog() {
  return buildSlashCatalog({
    skills: [
      {
        id: 'create-skill',
        name: 'create-skill',
        description: 'Create a skill',
        enabled: true,
      },
      {
        id: 'writing-plans',
        name: 'writing-plans',
        enabled: true,
      },
      {
        id: 'canvas',
        name: 'canvas',
        enabled: true,
      },
    ],
    compactionSupported: true,
    streaming: false,
    compacting: false,
    hasActiveSession: true,
    projectTrusted: true,
  });
}

describe('filterSlashItems', () => {
  it('ranks compact first for /comp query', () => {
    const filtered = filterSlashItems(catalog(), 'comp');
    expect(filtered[0]?.name).toBe('compact');
  });

  it('matches summarize alias to compact item', () => {
    const filtered = filterSlashItems(catalog(), 'summarize');
    expect(filtered.some((item) => item.name === 'compact')).toBe(true);
  });

  it('includes modes and create-skill with empty query', () => {
    const filtered = filterSlashItems(catalog(), '');
    const names = filtered.map((item) => item.name);
    expect(names).toContain('compact');
    expect(names).toContain('plan');
    expect(names).toContain('create-skill');
  });

  it('does not invent canvas as a command', () => {
    const items = catalog();
    // canvas may appear as a skill if present in skills list (user skill)
    // but never as command
    expect(items.find((item) => item.kind === 'command' && item.name === 'canvas')).toBeUndefined();
  });
});

describe('groupSlashItems', () => {
  it('orders Command then Mode then Skill', () => {
    const groups = groupSlashItems(filterSlashItems(catalog(), ''));
    expect(groups.map((group) => group.groupLabel)).toEqual(
      expect.arrayContaining(['Command', 'Mode', 'Skill']),
    );
    const labels = groups.map((group) => group.groupLabel);
    expect(labels.indexOf('Command')).toBeLessThan(labels.indexOf('Mode'));
    expect(labels.indexOf('Mode')).toBeLessThan(labels.indexOf('Skill'));
  });
});

describe('buildSlashCatalog availability', () => {
  it('marks compact unavailable while streaming', () => {
    const items = buildSlashCatalog({
      skills: [],
      hasActiveSession: true,
      projectTrusted: true,
      streaming: true,
    });
    const compact = items.find((item) => item.name === 'compact');
    expect(compact?.available).toBe(false);
  });

  it('marks stop available only while streaming', () => {
    const idle = buildSlashCatalog({
      skills: [],
      hasActiveSession: true,
      projectTrusted: true,
      streaming: false,
    });
    const streaming = buildSlashCatalog({
      skills: [],
      hasActiveSession: true,
      projectTrusted: true,
      streaming: true,
    });
    expect(idle.find((item) => item.name === 'stop')?.available).toBe(false);
    expect(streaming.find((item) => item.name === 'stop')?.available).toBe(true);
  });
});
