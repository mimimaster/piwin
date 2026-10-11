import { describe, expect, it } from 'vitest';
import { createDefaultArtifactTheme } from '@piwin/artifact';
import {
  artifactStyleLabel,
  artifactViewerWidthPx,
  artifactViewerWidths,
  nextArtifactPreviewTheme,
  resolveArtifactPreviewTheme,
  resolveArtifactViewerKey,
} from './artifact-viewer-model';

function key(k: string, extra: Partial<KeyboardEvent> = {}) {
  return { key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, target: null, ...extra };
}

describe('artifact viewer model', () => {
  it('offers three widths in Canvas and adds 1200 in fullscreen', () => {
    expect(artifactViewerWidths(false)).toEqual(['fit', 'desktop', 'mobile']);
    expect(artifactViewerWidths(true)).toContain('wide');
    expect(artifactViewerWidthPx('fit')).toBeUndefined();
    expect(artifactViewerWidthPx('desktop')).toBe(760);
    expect(artifactViewerWidthPx('mobile')).toBe(390);
    expect(artifactViewerWidthPx('wide')).toBe(1200);
  });

  it('cycles follow → paper → ink → follow', () => {
    expect(nextArtifactPreviewTheme('follow')).toBe('paper');
    expect(nextArtifactPreviewTheme('paper')).toBe('ink');
    expect(nextArtifactPreviewTheme('ink')).toBe('follow');
  });

  it('repaints only colors for a preview theme and keeps host typography', () => {
    const host = { ...createDefaultArtifactTheme('dark'), '--piwin-artifact-font-size': '15px' };
    expect(resolveArtifactPreviewTheme('follow', host)).toBe(host);
    const paper = resolveArtifactPreviewTheme('paper', host);
    expect(paper?.['--piwin-artifact-theme']).toBe('light');
    expect(paper?.['--piwin-artifact-font-size']).toBe('15px');
    expect(resolveArtifactPreviewTheme('ink', host)?.['--piwin-artifact-theme']).toBe('dark');
  });

  it('labels a fence without style as host', () => {
    expect(artifactStyleLabel(undefined)).toBe('host');
    expect(artifactStyleLabel('expressive')).toBe('expressive');
  });

  it('maps Canvas keys F, 1/2/3, T and ignores modified keys', () => {
    const canvas = { surface: 'canvas' as const, presets: true };
    expect(resolveArtifactViewerKey(key('f'), canvas)).toEqual({ kind: 'toggle-fullscreen' });
    expect(resolveArtifactViewerKey(key('2'), canvas)).toEqual({ kind: 'width', width: 'desktop' });
    expect(resolveArtifactViewerKey(key('3'), canvas)).toEqual({ kind: 'width', width: 'mobile' });
    expect(resolveArtifactViewerKey(key('4'), canvas)).toBeNull();
    expect(resolveArtifactViewerKey(key('t'), canvas)).toEqual({ kind: 'cycle-theme' });
    expect(resolveArtifactViewerKey(key('f', { metaKey: true }), canvas)).toBeNull();
    expect(resolveArtifactViewerKey(key('Escape'), canvas)).toBeNull();
  });

  it('maps fullscreen Esc and the wide preset', () => {
    const full = { surface: 'fullscreen' as const, presets: true };
    expect(resolveArtifactViewerKey(key('Escape'), full)).toEqual({ kind: 'exit-fullscreen' });
    expect(resolveArtifactViewerKey(key('4'), full)).toEqual({ kind: 'width', width: 'wide' });
  });

  it('drops presets on the mobile shell but keeps fullscreen', () => {
    const mobile = { surface: 'canvas' as const, presets: false };
    expect(resolveArtifactViewerKey(key('f'), mobile)).toEqual({ kind: 'toggle-fullscreen' });
    expect(resolveArtifactViewerKey(key('2'), mobile)).toBeNull();
    expect(resolveArtifactViewerKey(key('t'), mobile)).toBeNull();
  });

  it('maps ⌘⇧O on an Inline artifact to open-canvas', () => {
    const inline = { surface: 'inline' as const, presets: false };
    expect(resolveArtifactViewerKey(key('O', { metaKey: true, shiftKey: true }), inline)).toEqual({
      kind: 'open-canvas',
    });
    expect(resolveArtifactViewerKey(key('f'), inline)).toBeNull();
  });
});
