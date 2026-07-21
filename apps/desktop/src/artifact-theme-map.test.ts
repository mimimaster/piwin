import { describe, expect, it } from 'vitest';
import type { ThemeManifest } from '@piwin/contracts';
import { mapThemeToArtifactVariables } from './artifact-theme-map';

const sampleTheme: ThemeManifest = {
  id: 'test-dark',
  name: 'Test Dark',
  version: '1.0.0',
  mode: 'dark',
  tokens: {
    bg: '#0b0d12',
    panel: '#141824',
    panel2: '#1a2030',
    border: '#2a3142',
    text: '#e8ecf5',
    muted: '#9aa6bd',
    accent: '#6ea8fe',
    accent2: '#8b5cf6',
    danger: '#f87171',
    ok: '#4ade80',
    radius: '10px',
    font: 'system-ui, sans-serif',
  },
  artifact: {
    surface: 'rgba(30, 35, 48, 0.95)',
    accent: '#93c5fd',
  },
};

describe('mapThemeToArtifactVariables', () => {
  it('maps mode and prefers artifact overrides', () => {
    const vars = mapThemeToArtifactVariables(sampleTheme);
    expect(vars['--piwin-artifact-theme']).toBe('dark');
    expect(vars['--piwin-artifact-surface']).toBe('rgba(30, 35, 48, 0.95)');
    expect(vars['--piwin-artifact-accent']).toBe('#93c5fd');
    expect(vars['--piwin-artifact-text']).toBe('#e8ecf5');
  });

  it('falls back to default dark when theme missing', () => {
    const vars = mapThemeToArtifactVariables(null);
    expect(vars['--piwin-artifact-theme']).toBe('dark');
  });
});
