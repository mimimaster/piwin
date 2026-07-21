/**
 * Soft-repair hard-coded light surfaces so dark host themes stay readable.
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
 * Soft-repair light surfaces in model HTML for preview.
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

  return {
    source: output,
    issues,
    repairs,
    changed: repairs.length > 0,
  };
}
