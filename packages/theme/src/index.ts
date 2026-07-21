/** @piwin/theme — token theme packages under ~/.piwin/themes */

export { validateThemeManifest } from './validate-manifest.js';
export type { ThemeValidationIssue, ThemeValidationResult } from './validate-manifest.js';

export {
  getThemesDir,
  getThemePreferencePath,
  loadThemePreference,
  saveThemePreference,
  ensureBundledThemesInstalled,
  listThemes,
  loadThemeManifest,
  getActiveTheme,
  setActiveTheme,
  installThemeFromLocalPath,
  themeTokensToCssVariables,
} from './theme-store.js';
