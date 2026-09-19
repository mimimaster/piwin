/**
 * Soft-repair hard-coded colors so artifacts follow the host theme.
 * Light surfaces are always rewritten (dark hosts). Invented `--piwin-artifact-*`
 * names, stray light text, and dark surfaces are rewritten too (light / paper
 * hosts). A self-consistent dark *code* island (`pre` / `code` / `kbd` / hljs)
 * keeps its own contrast pair so listings stay readable. Dark full-page shells
 * and slate cards are not code — they become a black Canvas on a paper host
 * if left alone.
 * Ported from openwebui_m artifactThemeContract (subset) — soft repair only.
 */
import type {
  ArtifactThemeContractIssue,
  ArtifactThemeContractIssueKind,
  ArtifactThemeContractRepair,
  ArtifactThemeContractResult,
} from './types.js';

const SURFACE_REPLACEMENT = 'var(--piwin-artifact-surface)';
const SURFACE_CLASS_REPLACEMENT = 'piwin-artifact-surface';
const TEXT_REPLACEMENT = 'var(--piwin-artifact-text)';

const LIGHT_COLOR_PATTERN =
  /(?:\bwhite\b|#fff(?:fff)?\b|#f8fafc\b|#f9fafb\b|#f3f4f6\b|#fafafa\b|#f7f7f7\b|#f5f5f5\b|#eeeeee\b|#e5e7eb\b|rgba?\(\s*(?:24[5-9]|25[0-5])\s*,\s*(?:24[5-9]|25[0-5])\s*,\s*(?:24[5-9]|25[0-5])(?:\s*,\s*(?:0?\.?\d+|1(?:\.0)?))?\s*\)|hsl\(\s*0\s+0%\s+(?:9[2-9]|100)%\s*\)|oklch\(\s*(?:0?\.9\d+|1(?:\.0)?)\s+[^)]*\))/i;

const SURFACE_DECLARATION_PATTERN =
  /\b(background(?:-color)?)\s*:\s*([^;}\"'{]+)([;}\"']|$)/gi;

const LIGHT_VARIABLE_DECLARATION_PATTERN =
  /(--[a-z0-9_-]*(?:bg|background|surface|card|panel|tile|metric)[a-z0-9_-]*)\s*:\s*([^;}\"'{]+)([;}\"']|$)/gi;

const TAILWIND_LIGHT_CLASS_PATTERN =
  /(?<=[\s"'=]|^)(bg-white|bg-gray-(?:50|100|200|300)|from-white|via-white|to-white|from-gray-(?:50|100|200|300)|via-gray-(?:50|100|200|300)|to-gray-(?:50|100|200|300)|bg-\[(?:#fff|#ffffff|#fafafa|#f7f7f7|#f5f5f5|rgba\((?:24[5-9]|25[0-5])[^\]]*)\])(?=[\s"']|$)/gi;

function isLightSurfaceValue(value: string): boolean {
  return LIGHT_COLOR_PATTERN.test(value);
}

function isLightGradientValue(value: string): boolean {
  return /gradient\(/i.test(value) && LIGHT_COLOR_PATTERN.test(value);
}

function createIssue(
  kind: ArtifactThemeContractIssueKind,
  match: string,
  message: string,
  repaired: boolean,
): ArtifactThemeContractIssue {
  return { kind, match, message, repaired };
}

/**
 * Soft-repair hard-coded surfaces in model HTML for preview.
 * Does not hard-block; always returns a source that can still render.
 */
export function applyArtifactThemeContract(source: string): ArtifactThemeContractResult {
  const issues: ArtifactThemeContractIssue[] = [];
  const repairs: ArtifactThemeContractRepair[] = [];

  let output = source.replace(
    SURFACE_DECLARATION_PATTERN,
    (fullMatch, property: string, value: string, terminator: string) => {
      if (!isLightSurfaceValue(value)) {
        return fullMatch;
      }
      const kind: ArtifactThemeContractIssueKind = isLightGradientValue(value)
        ? 'fixed-light-gradient'
        : 'fixed-light-surface';
      const replacement = `${property}: ${SURFACE_REPLACEMENT}${terminator}`;
      issues.push(
        createIssue(
          kind,
          fullMatch,
          'Artifact used a fixed light background surface; replaced with theme surface.',
          true,
        ),
      );
      repairs.push({ kind, from: fullMatch, to: replacement });
      return replacement;
    },
  );

  output = output.replace(
    LIGHT_VARIABLE_DECLARATION_PATTERN,
    (fullMatch, property: string, value: string, terminator: string) => {
      if (!isLightSurfaceValue(value)) {
        return fullMatch;
      }
      const replacement = `${property}: ${SURFACE_REPLACEMENT}${terminator}`;
      issues.push(
        createIssue(
          'fixed-light-variable',
          fullMatch,
          'Artifact defined a local fixed light surface variable; replaced with theme surface.',
          true,
        ),
      );
      repairs.push({
        kind: 'fixed-light-variable',
        from: fullMatch,
        to: replacement,
      });
      return replacement;
    },
  );

  output = output.replace(TAILWIND_LIGHT_CLASS_PATTERN, (fullMatch) => {
    issues.push(
      createIssue(
        'tailwind-light-surface',
        fullMatch,
        'Artifact used a Tailwind fixed light surface class; replaced with theme surface class.',
        true,
      ),
    );
    repairs.push({
      kind: 'tailwind-light-surface',
      from: fullMatch,
      to: SURFACE_CLASS_REPLACEMENT,
    });
    return SURFACE_CLASS_REPLACEMENT;
  });

  output = output.replace(
    THEME_VARIABLE_REFERENCE_PATTERN,
    (fullMatch, prefix: string, name: string) => {
      const lower = name.toLowerCase();
      if (KNOWN_THEME_VARIABLES.has(lower)) {
        return fullMatch;
      }
      const replacement = `${prefix}--piwin-artifact-${nearestThemeVariable(lower)}`;
      issues.push(
        createIssue(
          'unknown-theme-variable',
          fullMatch,
          'Artifact referenced a theme variable the host does not define; mapped to the nearest one.',
          true,
        ),
      );
      repairs.push({ kind: 'unknown-theme-variable', from: fullMatch, to: replacement });
      return replacement;
    },
  );

  output = output.replace(
    STYLE_ELEMENT_PATTERN,
    (_fullMatch, open: string, css: string, close: string) =>
      `${open}${css.replace(
        CSS_RULE_PATTERN,
        (_rule, selector: string, body: string) =>
          `${selector}{${repairDeclarationBlock(body, issues, repairs, selector)}}`,
      )}${close}`,
  );
  output = output.replace(
    STYLE_ATTRIBUTE_ON_TAG_PATTERN,
    (_fullMatch, open: string, tagName: string, quote: string, body: string) =>
      `${open}${quote}${repairDeclarationBlock(body, issues, repairs, tagName)}${quote}`,
  );

  return {
    source: output,
    issues,
    repairs,
    changed: repairs.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Theme variable names and per-block color pairing
// ---------------------------------------------------------------------------

const KNOWN_THEME_VARIABLES = new Set([
  'theme',
  'bg',
  'surface',
  'text',
  'muted',
  'accent',
  'border',
  'radius',
  'font',
  'font-size',
  'line-height',
  'letter-spacing',
  'font-smoothing',
]);

const THEME_VARIABLE_REFERENCE_PATTERN = /(var\(\s*)--piwin-artifact-([a-z0-9_-]+)/gi;

function nearestThemeVariable(name: string): string {
  if (/muted|secondary|subtle|dim|faint/.test(name)) return 'muted';
  for (const base of ['surface', 'bg', 'text', 'accent', 'border', 'radius', 'font']) {
    if (name.startsWith(base)) return base;
  }
  if (/fg|foreground|heading|title|ink/.test(name)) return 'text';
  if (/line|divider|outline|stroke/.test(name)) return 'border';
  if (/primary|brand|highlight|link|info/.test(name)) return 'accent';
  return 'surface';
}

const STYLE_ELEMENT_PATTERN = /(<style\b[^>]*>)([\s\S]*?)(<\/style>|$)/gi;
const CSS_RULE_PATTERN = /([^{}]+)\{([^{}]*)\}/g;
const STYLE_ATTRIBUTE_ON_TAG_PATTERN =
  /(<([a-zA-Z][\w:-]*)\b[^>]*?\sstyle\s*=\s*)(["'])([^"']*)\3/gi;
const BACKGROUND_DECLARATION_PATTERN = /((?:^|[;\s])background(?:-color)?\s*:\s*)([^;]+)/i;
const COLOR_DECLARATION_PATTERN = /((?:^|[;\s])color\s*:\s*)([^;]+)/i;
const COLOR_TOKEN_PATTERN = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b/gi;
const CODE_LIKE_SELECTOR_PATTERN =
  /(?:^|[\s>+~])(?:pre|code|kbd|samp)(?:$|[\s.:#[>+~])|\.hljs\b|\.token\b|\.language-[\w-]+/i;

type Rgba = { r: number; g: number; b: number; a: number };

function parseColorToken(token: string): Rgba | undefined {
  const lower = token.toLowerCase();
  if (lower === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  if (lower === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  if (lower.startsWith('#')) {
    const hex = lower.slice(1);
    const full =
      hex.length === 3 || hex.length === 4
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex;
    if (full.length !== 6 && full.length !== 8) return undefined;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
    };
  }
  const parts = lower
    .replace(/^rgba?\(/, '')
    .replace(/\)$/, '')
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map((part) => (part.endsWith('%') ? (parseFloat(part) / 100) * 255 : parseFloat(part)));
  if (parts.length < 3 || parts.slice(0, 3).some((n) => Number.isNaN(n))) return undefined;
  const alpha = parts[3];
  return {
    r: parts[0]!,
    g: parts[1]!,
    b: parts[2]!,
    a: alpha === undefined || Number.isNaN(alpha) ? 1 : alpha > 1 ? alpha / 255 : alpha,
  };
}

function relativeLuminance({ r, g, b }: Rgba): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Opaque hard-coded colors in a value; empty when it leans on `var()`. */
function hardcodedColors(value: string): Rgba[] {
  if (/var\(/i.test(value)) return [];
  return (value.match(COLOR_TOKEN_PATTERN) ?? [])
    .map(parseColorToken)
    .filter((color): color is Rgba => color !== undefined && color.a >= 0.5);
}

function isDarkSurface(value: string): boolean {
  const colors = hardcodedColors(value);
  return colors.length > 0 && colors.every((color) => relativeLuminance(color) < 0.1);
}

function isLightText(value: string): boolean {
  const colors = hardcodedColors(value);
  return colors.length === 1 && relativeLuminance(colors[0]!) > 0.7;
}

/** A background that is meant to carry light text: an accent or a mid/dark fill. */
function backsLightText(background: string): boolean {
  if (/accent/i.test(background)) return true;
  return hardcodedColors(background).some((color) => relativeLuminance(color) < 0.5);
}

/** `pre` / `code` islands keep a dark contrast pair; page shells do not. */
function isCodeLikeSelector(selector: string): boolean {
  const normalized = selector.trim();
  if (!normalized) return false;
  return normalized
    .split(',')
    .every((part) => part.trim().length > 0 && CODE_LIKE_SELECTOR_PATTERN.test(part.trim()));
}

function repairDeclarationBlock(
  body: string,
  issues: ArtifactThemeContractIssue[],
  repairs: ArtifactThemeContractRepair[],
  selector: string,
): string {
  const background = BACKGROUND_DECLARATION_PATTERN.exec(body)?.[2]?.trim();
  const color = COLOR_DECLARATION_PATTERN.exec(body)?.[2]?.trim();
  const lightText = color !== undefined && isLightText(color);
  const rewriteDarkSurface =
    background !== undefined && isDarkSurface(background) && !isCodeLikeSelector(selector);
  let output = body;

  if (
    lightText &&
    (rewriteDarkSurface || background === undefined || !backsLightText(background))
  ) {
    output = output.replace(COLOR_DECLARATION_PATTERN, (fullMatch, prefix: string) => {
      const replacement = `${prefix}${TEXT_REPLACEMENT}`;
      issues.push(
        createIssue(
          'fixed-light-text',
          fullMatch.trim(),
          'Artifact used fixed light text that would not follow the host theme; replaced with theme text.',
          true,
        ),
      );
      repairs.push({ kind: 'fixed-light-text', from: fullMatch.trim(), to: replacement.trim() });
      return replacement;
    });
  }

  if (rewriteDarkSurface) {
    output = output.replace(BACKGROUND_DECLARATION_PATTERN, (fullMatch, prefix: string) => {
      const replacement = `${prefix}${SURFACE_REPLACEMENT}`;
      issues.push(
        createIssue(
          'fixed-dark-surface',
          fullMatch.trim(),
          'Artifact used a fixed dark surface; replaced with theme surface.',
          true,
        ),
      );
      repairs.push({ kind: 'fixed-dark-surface', from: fullMatch.trim(), to: replacement.trim() });
      return replacement;
    });
  }

  return output;
}
