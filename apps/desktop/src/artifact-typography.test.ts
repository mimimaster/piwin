import { afterEach, describe, expect, it, vi } from 'vitest';
import { readArtifactTypography, sameArtifactTypography } from './artifact-typography';

function stubComputedStyle(values: Record<string, string>): void {
  vi.stubGlobal('getComputedStyle', () => ({
    fontSize: values['font-size'] ?? '',
    lineHeight: values['line-height'] ?? '',
    getPropertyValue: (property: string) => values[property] ?? '',
  }) as unknown as CSSStyleDeclaration);
}

describe('readArtifactTypography', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hands the transcript leading through as a unitless ratio', () => {
    stubComputedStyle({
      'font-size': '14.5px',
      'line-height': '24.94px',
      'letter-spacing': 'normal',
      '-webkit-font-smoothing': 'antialiased',
    });
    expect(readArtifactTypography({} as Element)).toEqual({
      '--piwin-artifact-font-size': '14.5px',
      '--piwin-artifact-line-height': '1.72',
      '--piwin-artifact-letter-spacing': 'normal',
      '--piwin-artifact-font-smoothing': 'antialiased',
    });
  });

  it('keeps keyword leading and omits properties the engine does not report', () => {
    stubComputedStyle({ 'font-size': '16px', 'line-height': 'normal' });
    expect(readArtifactTypography({} as Element)).toEqual({
      '--piwin-artifact-font-size': '16px',
      '--piwin-artifact-line-height': 'normal',
    });
  });

  it('compares snapshots by value', () => {
    const typography = { '--piwin-artifact-font-size': '14.5px' };
    expect(sameArtifactTypography(null, typography)).toBe(false);
    expect(sameArtifactTypography({ ...typography }, typography)).toBe(true);
    expect(sameArtifactTypography(typography, { '--piwin-artifact-font-size': '16px' })).toBe(false);
  });
});
