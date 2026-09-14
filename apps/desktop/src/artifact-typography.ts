import type { ArtifactThemeVariables } from '@piwin/artifact';

export type ArtifactTypography = Pick<
  ArtifactThemeVariables,
  | '--piwin-artifact-font-size'
  | '--piwin-artifact-line-height'
  | '--piwin-artifact-letter-spacing'
  | '--piwin-artifact-font-smoothing'
>;

const TYPOGRAPHY_PROPERTIES = [
  ['--piwin-artifact-font-size', 'font-size'],
  ['--piwin-artifact-line-height', 'line-height'],
  ['--piwin-artifact-letter-spacing', 'letter-spacing'],
  ['--piwin-artifact-font-smoothing', '-webkit-font-smoothing'],
] as const;

/**
 * Snapshot the reading typography an Inline Artifact sits in. Static Shadow
 * DOM inherits it for free; the sandbox iframe starts from UA defaults (16px /
 * normal / auto smoothing), so without this the final static paint reflows.
 */
export function readArtifactTypography(element: Element): ArtifactTypography {
  const style = getComputedStyle(element);
  const typography: ArtifactTypography = {};
  for (const [variable, property] of TYPOGRAPHY_PROPERTIES) {
    const value = style.getPropertyValue(property).trim();
    if (value) typography[variable] = value;
  }
  const lineHeight = unitlessLineHeight(style.fontSize, style.lineHeight);
  if (lineHeight !== null) typography['--piwin-artifact-line-height'] = lineHeight;
  return typography;
}

/**
 * Computed line-height resolves to px, but transcript prose sets a unitless
 * ratio that children rescale by their own font-size. Passing the px value
 * would pin every heading to body leading, so hand the ratio through.
 */
function unitlessLineHeight(fontSize: string, lineHeight: string): string | null {
  if (!fontSize.endsWith('px') || !lineHeight.endsWith('px')) return null;
  const size = parseFloat(fontSize);
  const leading = parseFloat(lineHeight);
  if (!(size > 0) || !(leading > 0)) return null;
  return String(Math.round((leading / size) * 1000) / 1000);
}

export function sameArtifactTypography(
  left: ArtifactTypography | null,
  right: ArtifactTypography,
): boolean {
  if (left === null) return false;
  return TYPOGRAPHY_PROPERTIES.every(([variable]) => left[variable] === right[variable]);
}
