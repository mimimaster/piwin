import { describe, expect, it } from 'vitest';
import {
  LEGACY_SETTINGS_REDIRECTS,
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  isLegacySettingsSectionId,
  isSettingsSectionId,
  normalizeSettingsSection,
  sectionsForGroup,
  type SettingsSectionId,
} from './section-registry';

const ALL_SECTION_IDS: SettingsSectionId[] = [
  'general',
  'permissions',
  'models',
  'oauth',
  'hooks',
  'subagents',
  'agent',
  'extensions',
  'web',
  'knowledge',
  'session',
  'cold-storage',
  'usage',
  'archive',
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

  it('maps legacy deep links to canonical sections', () => {
    expect(normalizeSettingsSection('rules')).toBe('extensions');
    expect(normalizeSettingsSection('agents')).toBe('agent');
    expect(normalizeSettingsSection('bogus')).toBe('general');
    expect(normalizeSettingsSection('skills')).toBe('extensions');
    expect(normalizeSettingsSection('tools')).toBe('extensions');
    expect(normalizeSettingsSection('subagents')).toBe('subagents');
    expect(normalizeSettingsSection('web')).toBe('web');
    expect(normalizeSettingsSection('runtime')).toBe('session');
    expect(normalizeSettingsSection('archive')).toBe('archive');
    expect(normalizeSettingsSection('usage')).toBe('usage');
    expect(isLegacySettingsSectionId('rules')).toBe(true);
    expect(isLegacySettingsSectionId('agents')).toBe(true);
    expect(isLegacySettingsSectionId('general')).toBe(false);
    expect(isLegacySettingsSectionId('web')).toBe(false);
    expect(isLegacySettingsSectionId('archive')).toBe(false);
    expect(isLegacySettingsSectionId('usage')).toBe(false);
    expect(isLegacySettingsSectionId('image-generation')).toBe(true);
    expect(normalizeSettingsSection('image-generation')).toBe('models');
    expect(normalizeSettingsSection('oauth')).toBe('oauth');
    expect(normalizeSettingsSection('hooks')).toBe('hooks');
    expect(isLegacySettingsSectionId('subagents')).toBe(false);
    expect(isSettingsSectionId('subagents')).toBe(true);
    expect(Object.keys(LEGACY_SETTINGS_REDIRECTS).length).toBeGreaterThanOrEqual(13);
  });
});
