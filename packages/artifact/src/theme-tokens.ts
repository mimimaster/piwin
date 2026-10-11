/**
 * Runtime v14 artifact vocabulary (design: ~/piwin-artifact-design/design.md §3).
 *
 * Desktop maps these from the active theme's Deck ramp. Any caller that only
 * supplies the base seven still gets a complete, readable set: the fallbacks
 * below derive from the base vars, so an artifact never references an
 * undefined token.
 */
import type { ArtifactThemeVariables } from './types.js';

export const ARTIFACT_V14_TOKEN_NAMES = [
  'surface-2',
  'subtle',
  'border-strong',
  'ok',
  'warn',
  'risk',
  'info',
  'accent-2',
  'series-1',
  'series-2',
  'series-3',
  'series-4',
  'series-5',
  'series-6',
  'shadow-1',
  'shadow-2',
  'radius-sm',
  'radius-lg',
  'font-mono',
] as const;

export type ArtifactV14TokenName = (typeof ARTIFACT_V14_TOKEN_NAMES)[number];

const MONO_STACK = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

const v = (name: string): string => `var(--piwin-artifact-${name})`;
const mix = (color: string, percent: number, other: string): string =>
  `color-mix(in srgb, ${color} ${percent}%, ${other})`;

/** Fallbacks for a theme that only authored the base seven. */
export function deriveArtifactV14Tokens(
  mode: 'light' | 'dark',
): Record<ArtifactV14TokenName, string> {
  const dark = mode === 'dark';
  return {
    'surface-2': mix(v('text'), 6, v('surface')),
    subtle: mix(v('muted'), 82, v('surface')),
    'border-strong': mix(v('text'), dark ? 17 : 20, 'transparent'),
    ok: mix('#1f9d6b', 80, v('text')),
    warn: mix('#c7860f', 82, v('text')),
    risk: mix('#d5483f', 84, v('text')),
    info: mix('#3a86c8', 82, v('text')),
    'accent-2': mix('#d29a2c', 84, v('text')),
    'series-1': v('accent'),
    'series-2': v('info'),
    'series-3': v('ok'),
    'series-4': v('accent-2'),
    'series-5': v('risk'),
    'series-6': v('muted'),
    'shadow-1': dark
      ? '0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 1px 2px rgba(0, 0, 0, 0.35)'
      : '0 1px 2px rgba(0, 0, 0, 0.06)',
    'shadow-2': dark
      ? '0 1px 0 rgba(255, 255, 255, 0.05) inset, 0 8px 24px rgba(0, 0, 0, 0.45)'
      : '0 1px 2px rgba(0, 0, 0, 0.05), 0 8px 24px rgba(0, 0, 0, 0.08)',
    'radius-sm': '6px',
    'radius-lg': '14px',
    'font-mono': MONO_STACK,
  };
}

/** Every v14 token, authored values first, derived fallbacks for the rest. */
export function resolveArtifactV14Tokens(theme: ArtifactThemeVariables): Array<[string, string]> {
  const fallback = deriveArtifactV14Tokens(theme['--piwin-artifact-theme'] === 'dark' ? 'dark' : 'light');
  return ARTIFACT_V14_TOKEN_NAMES.map((name) => {
    const key = `--piwin-artifact-${name}` as keyof ArtifactThemeVariables;
    const authored = theme[key]?.trim();
    return [key, authored ? authored : fallback[name]];
  });
}
