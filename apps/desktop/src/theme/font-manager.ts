/**
 * Font management and CSS variable resolution for custom and built-in typography.
 * Dynamically registers FontFace instances into document.fonts and updates CSS variables.
 */

import { listCustomFonts, type StoredCustomFont } from './font-storage.js';
import { BUNDLED_FONT_FILES, type BundledFontRole } from './bundled-fonts.js';
import { parseFontMetadata } from './font-parser.js';

export interface CustomFontPreferences {
  sansFont?: string | undefined;
  monoFont?: string | undefined;
  serifFont?: string | undefined;
}

/** Used only when the shipped face has not been registered yet. */
export const DEFAULT_FONT_SANS =
  'Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", system-ui, sans-serif';

export const DEFAULT_FONT_MONO =
  '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';

export const DEFAULT_FONT_SERIF =
  "'Noto Serif SC', 'Songti SC', 'STSong', 'Source Han Serif SC', 'Source Serif 4', Georgia, serif";


const registeredFamilies = new Set<string>();
const bundledFamilies = new Map<BundledFontRole, string>();
let bundledRegistration: Promise<void> | null = null;

export function bundledFontFamily(role: BundledFontRole): string | undefined {
  return bundledFamilies.get(role);
}

/**
 * Builds a robust font family stack with fallback.
 */
export function buildFontStack(customFont: string | undefined, defaultStack: string): string {
  if (!customFont || customFont.trim() === '' || customFont === 'default') {
    return defaultStack;
  }
  const clean = customFont.trim();
  const quoted = clean.startsWith('"') || clean.startsWith("'") ? clean : `"${clean}"`;
  return `${quoted}, ${defaultStack}`;
}

/**
 * Computes the complete set of typography CSS variables.
 * An unset role uses the shipped face when it is already registered.
 */
export function computeFontVariables(prefs?: CustomFontPreferences): Record<string, string> {
  const sans = buildFontStack(prefs?.sansFont ?? bundledFamilies.get('sans'), DEFAULT_FONT_SANS);
  const mono = buildFontStack(prefs?.monoFont ?? bundledFamilies.get('mono'), DEFAULT_FONT_MONO);
  const serif = buildFontStack(prefs?.serifFont ?? bundledFamilies.get('serif'), DEFAULT_FONT_SERIF);

  return {
    '--font': sans,
    '--font-sans': sans,
    '--sans': sans,
    '--font-mono': mono,
    '--mono': mono,
    '--serif': serif,
    '--font-serif': serif,
    '--mantine-font-family': sans,
    '--mantine-font-family-monospace': mono,
  };
}

/**
 * Applies the font variables to the document root element.
 * With no custom preference, the shipped faces stay in place.
 */
export function applyCustomFontsToDocument(
  prefs?: CustomFontPreferences,
  targetRoot?: HTMLElement,
): void {
  const root =
    targetRoot ?? (typeof document !== 'undefined' ? document.documentElement : null);
  if (!root) return;

  const hasAny = prefs && Object.values(prefs).some((v) => Boolean(v && v !== 'default'));
  if (!hasAny && bundledFamilies.size === 0) {
    root.style.removeProperty('--sans');
    root.style.removeProperty('--font');
    root.style.removeProperty('--font-sans');
    root.style.removeProperty('--font-mono');
    root.style.removeProperty('--mono');
    root.style.removeProperty('--serif');
    root.style.removeProperty('--font-serif');
    root.style.removeProperty('--mantine-font-family');
    root.style.removeProperty('--mantine-font-family-monospace');
    root.style.fontFamily = '';
    return;
  }

  const vars = computeFontVariables(prefs);
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
  root.style.fontFamily = vars['--sans'] ?? DEFAULT_FONT_SANS;
}

async function loadFaceWithWeightFallback(family: string, data: ArrayBuffer): Promise<FontFace | null> {
  try {
    const face = new FontFace(family, data.slice(0), { weight: '100 900' });
    await face.load();
    return face;
  } catch {
    try {
      const face = new FontFace(family, data.slice(0));
      await face.load();
      return face;
    } catch (error) {
      console.warn(`Failed to load FontFace ${family}:`, error);
      return null;
    }
  }
}

/**
 * Dynamically registers a custom font in document.fonts.
 */
export async function registerCustomFontInDocument(font: StoredCustomFont): Promise<boolean> {
  if (typeof window === 'undefined' || typeof FontFace === 'undefined' || !('fonts' in document)) {
    return false;
  }

  try {
    const fontFace = await loadFaceWithWeightFallback(font.family, font.data);
    if (fontFace) {
      document.fonts.add(fontFace);
      registeredFamilies.add(font.family);
    }

    // Also register under the clean file base name if different from the parsed family
    const cleanBase = font.fileName.replace(/\.[a-zA-Z0-9]+$/, '').trim();
    if (cleanBase && cleanBase !== font.family && !registeredFamilies.has(cleanBase)) {
      const aliasFace = await loadFaceWithWeightFallback(cleanBase, font.data);
      if (aliasFace) {
        document.fonts.add(aliasFace);
        registeredFamilies.add(cleanBase);
      }
    }
    return true;
  } catch (error) {
    console.warn(`Failed to register custom font ${font.family}:`, error);
    return false;
  }
}

async function registerBundledRole(role: BundledFontRole): Promise<void> {
  if (bundledFamilies.has(role)) return;
  if (typeof window === 'undefined' || typeof FontFace === 'undefined' || !('fonts' in document)) {
    return;
  }
  const response = await fetch(BUNDLED_FONT_FILES[role]);
  if (!response.ok) {
    throw new Error(`bundled font ${role} responded ${response.status}`);
  }
  const data = await response.arrayBuffer();
  const meta = parseFontMetadata(data, BUNDLED_FONT_FILES[role]);
  const face = await loadFaceWithWeightFallback(meta.family, data);
  if (!face) return;
  document.fonts.add(face);
  registeredFamilies.add(meta.family);
  bundledFamilies.set(role, meta.family);
}

/**
 * Registers the three shipped faces under their sanitized family names.
 * Safe to call more than once; the fetch happens at most once per page.
 */
export function registerBundledFonts(): Promise<void> {
  if (bundledRegistration) return bundledRegistration;
  bundledRegistration = (async () => {
    const roles = Object.keys(BUNDLED_FONT_FILES) as BundledFontRole[];
    await Promise.all(
      roles.map(async (role) => {
        try {
          await registerBundledRole(role);
        } catch (error) {
          console.warn(`Failed to register bundled ${role} font:`, error);
        }
      }),
    );
  })();
  return bundledRegistration;
}

/**
 * Loads shipped faces, then every uploaded font, then paints the active stacks.
 */
export async function loadAndRegisterAllCustomFonts(prefs?: CustomFontPreferences): Promise<void> {
  await registerBundledFonts();
  try {
    const fonts = await listCustomFonts();
    for (const font of fonts) {
      await registerCustomFontInDocument(font);
    }
  } catch (error) {
    console.warn('Failed to load custom fonts from storage:', error);
  }

  applyCustomFontsToDocument(prefs);
}
