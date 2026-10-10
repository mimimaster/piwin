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
import { parseColorToken, relativeLuminance, type Rgba } from './color-luminance.js';
import type {
  ArtifactThemeContractIssue,
  ArtifactThemeContractIssueKind,
  ArtifactThemeContractRepair,
  ArtifactThemeContractResult,
} from './types.js';

const SURFACE_REPLACEMENT = 'var(--piwin-artifact-surface)';
const SURFACE_CLASS_REPLACEMENT = 'piwin-artifact-surface';
const TEXT_REPLACEMENT = 'var(--piwin-artifact-text)';
const ON_ACCENT_REPLACEMENT = 'var(--piwin-artifact-on-accent)';
/** The page canvas for the active color scheme: the inverse of theme text. */
const ON_TEXT_REPLACEMENT = 'Canvas';

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

export type ArtifactThemeContractOptions = {
  /**
   * `own`: the artifact paints its own scene, so fixed colors stay as drawn.
   * Invented theme variable names are still mapped. Default `host`.
   */
  palette?: 'host' | 'own';
};

/**
 * Soft-repair hard-coded surfaces in model HTML for preview.
 * Does not hard-block; always returns a source that can still render.
 */
export function applyArtifactThemeContract(
  source: string,
  options: ArtifactThemeContractOptions = {},
): ArtifactThemeContractResult {
  const issues: ArtifactThemeContractIssue[] = [];
  const repairs: ArtifactThemeContractRepair[] = [];
  const repairColors = options.palette !== 'own';

  let output = repairColors ? repairLightSurfaces(source, issues, repairs) : source;

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

  output = repairRuleColorPairs(output, issues, repairs, repairColors);

  return {
    source: output,
    issues,
    repairs,
    changed: repairs.length > 0,
  };
}

function repairLightSurfaces(
  source: string,
  issues: ArtifactThemeContractIssue[],
  repairs: ArtifactThemeContractRepair[],
): string {
  let output = source.replace(
    SURFACE_DECLARATION_PATTERN,
    (fullMatch, property: string, value: string, terminator: string, offset: number) => {
      if (
        !isLightSurfaceValue(value) ||
        isSeeThroughFill(value, LIGHT_SURFACE_OPAQUE_ALPHA) ||
        isParticleShapeBlock(enclosingDeclarationBlock(source, offset))
      ) {
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

  return output;
}

function repairRuleColorPairs(
  source: string,
  issues: ArtifactThemeContractIssue[],
  repairs: ArtifactThemeContractRepair[],
  repairFixedColors: boolean,
): string {
  const repairBlock = (body: string, selector: string): string =>
    repairFillInk(
      repairFixedColors ? repairDeclarationBlock(body, issues, repairs, selector) : body,
      issues,
      repairs,
    );
  let output = source;
  output = output.replace(
    STYLE_ELEMENT_PATTERN,
    (_fullMatch, open: string, css: string, close: string) =>
      `${open}${css.replace(
        CSS_RULE_PATTERN,
        (_rule, selector: string, body: string) =>
          `${selector}{${repairBlock(body, selector)}}`,
      )}${close}`,
  );
  output = output.replace(
    STYLE_ATTRIBUTE_ON_TAG_PATTERN,
    (_fullMatch, open: string, tagName: string, quote: string, body: string) =>
      `${open}${quote}${repairBlock(body, tagName)}${quote}`,
  );

  return output;
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
  'on-accent',
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
  // Before the `accent` prefix match: an invented "text on accent" name mapped
  // to `accent` itself paints the label in its own fill color.
  if (/on-accent|^accent-(?:on|fg|foreground|contrast|text|ink|label)\b/.test(name)) {
    return 'on-accent';
  }
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

/** Opaque hard-coded colors in a value; empty when it leans on `var()`. */
function hardcodedColors(value: string): Rgba[] {
  if (/var\(/i.test(value)) return [];
  return (value.match(COLOR_TOKEN_PATTERN) ?? [])
    .map(parseColorToken)
    .filter((color): color is Rgba => color !== undefined && color.a >= 0.5);
}

/**
 * Below this alpha a fill is read as an overlay rather than a surface. Dark
 * scrims run up to ~0.8, so only a nearly solid dark fill counts as a surface.
 * Frosted light cards sit at 0.6+ and still need the repair for theme text.
 */
const DARK_SURFACE_OPAQUE_ALPHA = 0.9;
const LIGHT_SURFACE_OPAQUE_ALPHA = 0.5;

/**
 * A scrim, vignette, or glow shows the content under it. Swapping it for the
 * opaque theme surface turns it into a sheet that hides the artwork it sat on.
 */
function isSeeThroughFill(value: string, opaqueAlpha: number): boolean {
  if (/\btransparent\b/i.test(value)) return true;
  return (value.match(COLOR_TOKEN_PATTERN) ?? [])
    .map(parseColorToken)
    .some((color) => color !== undefined && color.a < opaqueAlpha);
}

/** The declarations sharing a rule or `style` attribute with `offset`. */
function enclosingDeclarationBlock(source: string, offset: number): string {
  const start = Math.max(
    source.lastIndexOf('{', offset),
    source.lastIndexOf('"', offset),
    source.lastIndexOf("'", offset),
  );
  const ends = ['}', '"', "'"]
    .map((mark) => source.indexOf(mark, offset))
    .filter((index) => index >= 0);
  return source.slice(start + 1, ends.length > 0 ? Math.min(...ends) : source.length);
}

const CIRCLE_SHAPE_PATTERN = /(?:^|[;\s])border-radius\s*:\s*50%/i;
const OUT_OF_FLOW_PATTERN = /(?:^|[;\s])position\s*:\s*(?:absolute|fixed)\b/i;

/**
 * An out-of-flow circle is a drawn mark (snowflake, star, spark), not a
 * surface holding text. Recoloring it to the theme surface erases it against
 * the scene it decorates.
 */
function isParticleShapeBlock(block: string): boolean {
  return CIRCLE_SHAPE_PATTERN.test(block) && OUT_OF_FLOW_PATTERN.test(block);
}

function isDarkSurface(value: string): boolean {
  if (isSeeThroughFill(value, DARK_SURFACE_OPAQUE_ALPHA)) return false;
  const colors = hardcodedColors(value);
  return colors.length > 0 && colors.every((color) => relativeLuminance(color) < 0.1);
}

function isLightText(value: string): boolean {
  const colors = hardcodedColors(value);
  return colors.length === 1 && relativeLuminance(colors[0]!) > 0.7;
}

/** A background that is meant to carry light text: an accent or a mid/dark fill. */
function backsLightText(background: string): boolean {
  // An accent tint (`color-mix(... accent 12%, transparent)`) is a wash over
  // the page, not a fill: light text on it is light text on the page.
  if (/accent/i.test(background)) return !/\btransparent\b/i.test(background);
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

// A model-supplied fallback (`var(--piwin-artifact-accent, #2563eb)`) never
// applies, since the host always defines the variable; it is still that fill.
const SOLID_THEME_FILL_PATTERN = /^var\(\s*--piwin-artifact-(accent|text)\s*(?:,[^)]*)?\)$/i;
const NON_INK_THEME_COLOR_PATTERN =
  /^var\(\s*--piwin-artifact-(bg|surface|accent)\s*(?:,[^)]*)?\)$/i;

/**
 * A solid `accent` or `text` fill needs an ink of its own. Models reach for
 * `bg` or `surface` as "the opposite of text", but `bg` is transparent and
 * `surface` is a tint, so the label vanishes into the fill. A fixed `#fff` on
 * `accent` fails the same way on a theme whose accent is pale.
 */
function repairFillInk(
  body: string,
  issues: ArtifactThemeContractIssue[],
  repairs: ArtifactThemeContractRepair[],
): string {
  const fill = SOLID_THEME_FILL_PATTERN.exec(
    BACKGROUND_DECLARATION_PATTERN.exec(body)?.[2]?.trim() ?? '',
  )?.[1]?.toLowerCase();
  const color = COLOR_DECLARATION_PATTERN.exec(body)?.[2]?.trim();
  if (fill === undefined || color === undefined) return body;
  const themeInk = NON_INK_THEME_COLOR_PATTERN.exec(color)?.[1]?.toLowerCase();
  const fixedInkOnAccent = fill === 'accent' && hardcodedColors(color).length > 0;
  if (themeInk === undefined && !fixedInkOnAccent) return body;
  // Accent text on a `text` fill is a legitimate, readable pairing.
  if (fill === 'text' && themeInk === 'accent') return body;

  const inkReplacement = fill === 'accent' ? ON_ACCENT_REPLACEMENT : ON_TEXT_REPLACEMENT;
  return body.replace(COLOR_DECLARATION_PATTERN, (fullMatch, prefix: string) => {
    const replacement = `${prefix}${inkReplacement}`;
    issues.push(
      createIssue(
        'unreadable-fill-text',
        fullMatch.trim(),
        'Artifact put an ink on a solid theme fill that the host theme cannot keep readable; replaced with the matching ink.',
        true,
      ),
    );
    repairs.push({ kind: 'unreadable-fill-text', from: fullMatch.trim(), to: replacement.trim() });
    return replacement;
  });
}
