import { describe, expect, it } from 'vitest';
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  isSettingsSectionId,
  sectionsForGroup,
  type SettingsSectionId,
} from './section-registry';

const ALL_SECTION_IDS: SettingsSectionId[] = [
  'general',
  'appearance',
  'models',
  'agents',
  'rules',
  'skills',
  'extensions',
  'prompts',
  'tools',
  'web',
  'session',
  'memory',
  'automation',
  'pets',
];

describe('section registry', () => {
  it('lists every section id exactly once', () => {
    const ids = SETTINGS_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...ALL_SECTION_IDS].sort());
  });

  it('assigns every section to a declared group', () => {
    const groupIds = new Set(SETTINGS_GROUPS.map((group) => group.id));
    for (const section of SETTINGS_SECTIONS) {
      expect(groupIds.has(section.group)).toBe(true);
    }
  });

  it('covers every group and partitions sections across groups', () => {
    const partitioned = SETTINGS_GROUPS.flatMap((group) => sectionsForGroup(group.id));
    expect(partitioned).toHaveLength(SETTINGS_SECTIONS.length);
  });

  it('isSettingsSectionId accepts all ids and rejects unknown values', () => {
    for (const id of ALL_SECTION_IDS) {
      expect(isSettingsSectionId(id)).toBe(true);
    }
    expect(isSettingsSectionId('bogus')).toBe(false);
    expect(isSettingsSectionId('')).toBe(false);
  });
});
