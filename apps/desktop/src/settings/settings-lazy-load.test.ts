import { describe, expect, it } from 'vitest';
import { getSettingsSection } from './section-registry';
import {
  ensureSettingsLazyLoaded,
  isSettingsBasicSection,
  SETTINGS_BASIC_SECTION_IDS,
} from './settings-lazy-load';
import './pages/basic.js';

describe('settings lazy load (Chrome two-bundle)', () => {
  it('treats only general as the basic first-paint section', () => {
    expect(SETTINGS_BASIC_SECTION_IDS).toEqual(['general']);
    expect(isSettingsBasicSection('general')).toBe(true);
    expect(isSettingsBasicSection('models')).toBe(false);
    expect(isSettingsBasicSection('extensions')).toBe(false);
  });

  it('registers the basic page without pulling the lazy bundle', () => {
    expect(getSettingsSection('general')).toBeTypeOf('function');
    expect(getSettingsSection('models')).toBeUndefined();
    expect(getSettingsSection('web')).toBeUndefined();
    expect(getSettingsSection('extensions')).toBeUndefined();
    expect(getSettingsSection('knowledge')).toBeUndefined();
  });

  it('registers remaining sections exactly once through ensureSettingsLazyLoaded', async () => {
    await ensureSettingsLazyLoaded();
    await ensureSettingsLazyLoaded();
    expect(getSettingsSection('models')).toBeTypeOf('function');
    expect(getSettingsSection('oauth')).toBeTypeOf('function');
    expect(getSettingsSection('hooks')).toBeTypeOf('function');
    expect(getSettingsSection('permissions')).toBeTypeOf('function');
    expect(getSettingsSection('agent')).toBeTypeOf('function');
    expect(getSettingsSection('extensions')).toBeTypeOf('function');
    expect(getSettingsSection('web')).toBeTypeOf('function');
    expect(getSettingsSection('knowledge')).toBeTypeOf('function');
    expect(getSettingsSection('session')).toBeTypeOf('function');
    expect(getSettingsSection('cold-storage')).toBeTypeOf('function');
    expect(getSettingsSection('usage')).toBeTypeOf('function');
    expect(getSettingsSection('archive')).toBeTypeOf('function');
  });
});
