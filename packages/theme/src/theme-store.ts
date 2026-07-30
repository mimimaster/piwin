/**
 * List / install / activate themes under ~/.piwin/themes.
 */
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { ThemeManifest, ThemePreference, ThemeSummary } from '@piwin/contracts';
import { validateThemeManifest } from './validate-manifest.js';
import { resolveBundledAssetsRoot } from './bundled-assets-root.js';

export function getThemesDir(piwinRoot: string): string {
  return join(piwinRoot, 'themes');
}

export function getThemePreferencePath(piwinRoot: string): string {
  return join(piwinRoot, 'theme.json');
}

export async function loadThemePreference(piwinRoot: string): Promise<ThemePreference> {
  try {
    const raw = await readFile(getThemePreferencePath(piwinRoot), 'utf8');
    const parsed = JSON.parse(raw) as { activeThemeId?: string };
    if (typeof parsed.activeThemeId === 'string' && parsed.activeThemeId.trim()) {
      return { activeThemeId: parsed.activeThemeId.trim() };
    }
  } catch {
    // default
  }
  return { activeThemeId: 'piwin-dark' };
}

export async function saveThemePreference(
  piwinRoot: string,
  preference: ThemePreference,
): Promise<void> {
  const path = getThemePreferencePath(piwinRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(preference, null, 2)}\n`, 'utf8');
}

export async function ensureBundledThemesInstalled(
  piwinRoot: string,
  bundledRoot?: string,
): Promise<string[]> {
  const sourceRoot =
    bundledRoot ??
    resolveBundledAssetsRoot({
      layoutPath: 'theme/bundled',
      moduleUrl: import.meta.url,
      relativeFallback: '../bundled',
    });
  const targetRoot = getThemesDir(piwinRoot);
  await mkdir(targetRoot, { recursive: true });
  let entries: string[] = [];
  try {
    entries = await readdir(sourceRoot);
  } catch {
    return [];
  }
  const installed: string[] = [];
  for (const entry of entries) {
    const from = join(sourceRoot, entry);
    const to = join(targetRoot, entry);
    try {
      if (!(await stat(from)).isDirectory()) continue;
      let shouldInstall = false;
      try {
        // Bundled copies are product-owned caches, not user data: refresh the
        // install whenever the shipped manifest is newer than the copy.
        const installedRaw = await readFile(join(to, 'theme.json'), 'utf8');
        const sourceRaw = await readFile(join(from, 'theme.json'), 'utf8');
        const installedVersion = (JSON.parse(installedRaw) as { version?: string }).version;
        const sourceVersion = (JSON.parse(sourceRaw) as { version?: string }).version;
        shouldInstall = isNewerThemeVersion(sourceVersion, installedVersion);
      } catch {
        shouldInstall = true;
      }
      if (!shouldInstall) continue;
      await cp(from, to, { recursive: true, force: true });
      installed.push(entry);
    } catch {
      // ignore single theme failures
    }
  }
  return installed;
}

/** Compare "x.y.z" versions; true when candidate is strictly newer. */
function isNewerThemeVersion(candidate: string | undefined, current: string | undefined): boolean {
  if (!candidate) return false;
  if (!current) return true;
  const parse = (value: string): number[] =>
    value.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const next = parse(candidate);
  const prev = parse(current);
  for (let index = 0; index < 3; index += 1) {
    const diff = (next[index] ?? 0) - (prev[index] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

export async function listThemes(piwinRoot: string): Promise<{
  themes: ThemeSummary[];
  activeThemeId: string;
}> {
  await ensureBundledThemesInstalled(piwinRoot);
  const preference = await loadThemePreference(piwinRoot);
  const themesDir = getThemesDir(piwinRoot);
  let entries: string[] = [];
  try {
    entries = await readdir(themesDir);
  } catch {
    entries = [];
  }
  const themes: ThemeSummary[] = [];
  for (const entry of entries) {
    const themePath = join(themesDir, entry);
    const manifestPath = join(themePath, 'theme.json');
    try {
      if (!(await stat(themePath)).isDirectory()) continue;
      const raw = await readFile(manifestPath, 'utf8');
      const validated = validateThemeManifest(JSON.parse(raw));
      if (!validated.ok) continue;
      const source: ThemeSummary['source'] =
        entry === 'piwin-dark' || entry === 'piwin-light' || entry === 'piwin-orange-white'
          ? 'bundled'
          : 'user';
      themes.push({
        id: validated.manifest.id,
        name: validated.manifest.name,
        version: validated.manifest.version,
        mode: validated.manifest.mode,
        path: themePath,
        source,
        active: validated.manifest.id === preference.activeThemeId,
      });
    } catch {
      // skip invalid packages
    }
  }
  themes.sort((a, b) => a.name.localeCompare(b.name));
  return { themes, activeThemeId: preference.activeThemeId };
}

export async function loadThemeManifest(
  piwinRoot: string,
  themeId: string,
): Promise<ThemeManifest> {
  await ensureBundledThemesInstalled(piwinRoot);
  const themePath = join(getThemesDir(piwinRoot), themeId, 'theme.json');
  const raw = await readFile(themePath, 'utf8');
  const validated = validateThemeManifest(JSON.parse(raw));
  if (!validated.ok) {
    throw new Error(
      `invalid theme ${themeId}: ${validated.issues.map((issue) => issue.message).join('; ')}`,
    );
  }
  return validated.manifest;
}

export async function getActiveTheme(piwinRoot: string): Promise<ThemeManifest> {
  const preference = await loadThemePreference(piwinRoot);
  try {
    return await loadThemeManifest(piwinRoot, preference.activeThemeId);
  } catch {
    return loadThemeManifest(piwinRoot, 'piwin-dark');
  }
}

export async function setActiveTheme(piwinRoot: string, themeId: string): Promise<ThemeManifest> {
  const manifest = await loadThemeManifest(piwinRoot, themeId);
  await saveThemePreference(piwinRoot, { activeThemeId: manifest.id });
  return manifest;
}

export async function installThemeFromLocalPath(
  piwinRoot: string,
  sourcePath: string,
): Promise<{ themeId: string; path: string }> {
  const manifestPath = join(sourcePath, 'theme.json');
  const raw = await readFile(manifestPath, 'utf8');
  const validated = validateThemeManifest(JSON.parse(raw));
  if (!validated.ok) {
    throw new Error(validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
  }
  const target = join(getThemesDir(piwinRoot), validated.manifest.id);
  await mkdir(getThemesDir(piwinRoot), { recursive: true });
  await cp(sourcePath, target, { recursive: true, force: true });
  // rewrite canonical manifest
  await writeFile(
    join(target, 'theme.json'),
    `${JSON.stringify(validated.manifest, null, 2)}\n`,
    'utf8',
  );
  return { themeId: validated.manifest.id, path: target };
}

/** CSS custom properties for desktop :root */
export function themeTokensToCssVariables(manifest: ThemeManifest): Record<string, string> {
  const tokens = manifest.tokens;
  return {
    '--bg': tokens.bg,
    '--panel': tokens.panel,
    '--panel-2': tokens.panel2,
    '--border': tokens.border,
    '--text': tokens.text,
    '--muted': tokens.muted,
    '--accent': tokens.accent,
    '--accent-2': tokens.accent2,
    '--danger': tokens.danger,
    '--ok': tokens.ok,
    '--radius': tokens.radius,
    'font-family': tokens.font,
  };
}
