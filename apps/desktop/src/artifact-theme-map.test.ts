import { describe, expect, it } from 'vitest';
import type { ThemeManifest } from '@piwin/contracts';
import { readFileSync } from 'node:fs';
import { ARTIFACT_V14_TOKEN_NAMES } from '@piwin/artifact';
import { mapThemeToArtifactVariables } from './artifact-theme-map';
import { resolveDeckTokens } from './theme/deck-derive';

function bundledTheme(id: string): ThemeManifest {
  const url = new URL(`../../../packages/theme/bundled/${id}/theme.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as ThemeManifest;
}

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
    // Inline Artifact documents remain transparent and visually join the transcript.
    expect(vars['--piwin-artifact-bg']).toBe('transparent');
  });

  it('falls back to default dark when theme missing', () => {
    const vars = mapThemeToArtifactVariables(null);
    expect(vars['--piwin-artifact-theme']).toBe('dark');
    expect(vars['--piwin-artifact-bg']).toBe('transparent');
  });

  it('passes the Deck on-iris ink as the v14 on-accent input', () => {
    const derived = mapThemeToArtifactVariables(sampleTheme);
    expect(derived['--piwin-artifact-on-accent-themed']).toMatch(/^#|^rgb/);
    const authored = mapThemeToArtifactVariables({
      ...sampleTheme,
      artifact: { ...sampleTheme.artifact, onAccent: '#101010' },
    });
    expect(authored['--piwin-artifact-on-accent-themed']).toBe('#101010');
  });

  it.each(['piwin-inkstone-ink', 'piwin-inkstone-paper'])(
    'maps the full v14 vocabulary from the %s Deck ramp',
    (id) => {
      const theme = bundledTheme(id);
      const deck = resolveDeckTokens(theme);
      const vars = mapThemeToArtifactVariables(theme) as Record<string, string | undefined>;
      for (const name of ARTIFACT_V14_TOKEN_NAMES) {
        expect(vars[`--piwin-artifact-${name}`], name).toBeTruthy();
      }
      expect(vars['--piwin-artifact-ok']).toBe(deck.mint);
      expect(vars['--piwin-artifact-warn']).toBe(deck.amber);
      expect(vars['--piwin-artifact-risk']).toBe(deck.coral);
      expect(vars['--piwin-artifact-info']).toBe(deck.sky);
      expect(vars['--piwin-artifact-series-1']).toBe(deck.iris);
      expect(vars['--piwin-artifact-surface-2']).toBe(
        theme.mode === 'dark' ? deck.surface4 : deck.surface2,
      );
      expect(vars['--piwin-artifact-surface-2']).not.toBe(vars['--piwin-artifact-surface']);
    },
  );

  it('lets a theme author override v14 tokens', () => {
    const vars = mapThemeToArtifactVariables({
      ...sampleTheme,
      artifact: { ...sampleTheme.artifact, ok: '#00ff88', surface2: '#202020' },
    });
    expect(vars['--piwin-artifact-ok']).toBe('#00ff88');
    expect(vars['--piwin-artifact-surface-2']).toBe('#202020');
  });
});
