/**
 * Chromium Settings split: Basic first-paint vs lazy_load for Advanced/subpages.
 * `ensureSettingsLazyLoaded()` is the analogue of Chromium `ensureLazyLoaded()`.
 */
import { type SettingsSectionId } from './section-registry';

export const SETTINGS_BASIC_SECTION_IDS = ['general'] as const satisfies readonly SettingsSectionId[];

export function isSettingsBasicSection(id: SettingsSectionId): boolean {
  return (SETTINGS_BASIC_SECTION_IDS as readonly SettingsSectionId[]).includes(id);
}

let lazyLoadPromise: Promise<void> | null = null;

/** Load and register every non-basic settings section. Idempotent. */
export function ensureSettingsLazyLoaded(): Promise<void> {
  if (lazyLoadPromise === null) {
    lazyLoadPromise = import('./pages/lazy-load.js').then(() => undefined);
  }
  return lazyLoadPromise;
}
