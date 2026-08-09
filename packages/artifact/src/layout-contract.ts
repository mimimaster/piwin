/**
 * Soft-repair layout anti-patterns that inflate artifact iframe height.
 *
 * Root cause being addressed: a wrapper with `height: 100vh` (or a min-height
 * viewport unit) creates a positive-feedback loop with the height bridge — the
 * iframe grows, 100vh grows with it, the bridge measures taller, the iframe
 * grows again, until it reaches the defensive Inline flow ceiling. The rendered UI
 * stays small while the iframe is far taller, leaving a large blank area.
 *
 * Unlike the theme contract (which repairs color literals), this repairs the
 * model's use of viewport-relative sizing inside an inline chat component.
 */
import type { ArtifactLayoutContractIssueKind, ArtifactLayoutContractRepair } from './types.js';

export type ArtifactLayoutContractResult = {
  source: string;
  repairs: ArtifactLayoutContractRepair[];
  changed: boolean;
};

const FULL_PAGE_HEIGHT_PATTERN =
  /(^|[;{>\s"'])((?:min-)?height)\s*:\s*(?:100(?:vh|dvh|svh|lvh)\b|calc\([^)]*100(?:vh|dvh|svh|lvh)[^)]*\))/gi;

const repairValueFor = (property: string): string =>
  property === 'min-height' ? 'min-height: 0' : 'height: auto';

/**
 * Neutralize viewport-unit heights in model HTML so the artifact cannot grow
 * to full-viewport height inside a chat column. Applies to <style> blocks and
 * inline style="" attributes; the leading boundary class skips media-query
 * feature values (e.g. `@media (min-height: 100vh)`).
 */
export function applyArtifactLayoutContract(source: string): ArtifactLayoutContractResult {
  const repairs: ArtifactLayoutContractRepair[] = [];

  const output = source.replace(
    FULL_PAGE_HEIGHT_PATTERN,
    (fullMatch, leading: string, property: string, offset: number) => {
      const replacement = `${leading}${repairValueFor(property)}`;
      repairs.push({
        kind: 'full-page-height',
        from: fullMatch,
        to: replacement,
      });
      void offset;
      return replacement;
    },
  );

  return {
    source: output,
    repairs,
    changed: repairs.length > 0,
  };
}

export type { ArtifactLayoutContractIssueKind, ArtifactLayoutContractRepair };
