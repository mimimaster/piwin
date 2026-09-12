import { describe, expect, it } from 'vitest';
import type { SettingsSectionId } from './section-registry.js';
import { matchesSettingsSearch } from './settings-search-index.js';

describe('settings search index', () => {
  it.each([
    ['font', 'general'],
    ['theme', 'general'],
    ['快捷键', 'general'],
    ['skills', 'extensions'],
    ['runtime', 'session'],
    ['image-generation', 'models'],
    ['编排', 'subagents'],
    ['orchestration', 'subagents'],
  ])('routes %s to %s', (query, id) => {
    expect(matchesSettingsSearch(query, { id: id as SettingsSectionId })).toBe(true);
  });

  it('includes visible labels in matching', () => {
    expect(matchesSettingsSearch('General Preferences', { id: 'general' }, ['General Preferences'])).toBe(true);
  });

  it('rejects an unknown query', () => {
    expect(matchesSettingsSearch('does-not-exist', { id: 'general' })).toBe(false);
  });
});
