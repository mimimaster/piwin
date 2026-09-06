import type { ReactElement } from 'react';
import { buildAppearanceTheme } from '../../appearance-tokens.js';
import type { AppearanceThemeSettings } from '../../ui-preferences.js';

/** A token-driven miniature of the real three-panel shell, never a screenshot
 * that goes stale when the user edits a color. */
export function AppearanceThemePreview({ mode, settings }: {
  mode: 'light' | 'dark';
  settings: AppearanceThemeSettings;
}): ReactElement {
  const theme = buildAppearanceTheme(mode, settings);
  const panel = theme.deck?.surface1 ?? theme.tokens.panel;
  const stage = theme.deck?.surface2 ?? theme.tokens.panel2;
  const raised = theme.deck?.surface3 ?? theme.tokens.panel;
  const ink = theme.tokens.text;
  const accent = theme.tokens.accent;
  return (
    <svg className="appearance-shell-preview" viewBox="0 0 320 156" aria-hidden="true">
      <rect width="320" height="156" rx="8" fill={settings.background} />
      <g fill={ink} opacity=".35">
        <circle cx="12" cy="10" r="2" /><circle cx="20" cy="10" r="2" /><circle cx="28" cy="10" r="2" />
        <rect x="141" y="8" width="42" height="3" rx="1.5" />
      </g>
      <rect x="5" y="20" width="62" height="131" rx="5" fill={panel} />
      <rect x="72" y="20" width="166" height="131" rx="5" fill={stage} />
      <rect x="243" y="20" width="72" height="131" rx="5" fill={panel} />
      <rect x="10" y="26" width="42" height="9" rx="3" fill={raised} />
      <rect x="55" y="26" width="8" height="9" rx="2" fill={accent} />
      <path d="M15 49v49" stroke={ink} opacity=".18" />
      <g fill={ink} opacity=".3">
        <rect x="11" y="41" width="24" height="2" rx="1" />
        <rect x="22" y="51" width="34" height="2" rx="1" />
        <rect x="22" y="64" width="28" height="2" rx="1" />
        <rect x="22" y="77" width="34" height="2" rx="1" />
        <rect x="22" y="90" width="23" height="2" rx="1" />
        <rect x="250" y="29" width="22" height="3" rx="1" />
        <rect x="250" y="43" width="55" height="2" rx="1" />
        <rect x="250" y="53" width="39" height="2" rx="1" />
      </g>
      <circle cx="15" cy="52" r="2.5" fill={accent} />
      <rect x="85" y="32" width="140" height="21" rx="4" fill={raised} />
      <path d="M93 40h92m-92 6h64" stroke={ink} opacity=".4" strokeWidth="2" />
      <path d="M90 65v28" stroke={ink} opacity=".15" />
      <g stroke={ink} opacity=".3" strokeWidth="2">
        <path d="M98 65h78m-78 10h96m-96 10h70m-80 16h125" />
      </g>
      <rect x="85" y="112" width="140" height="31" rx="5" fill={mode === 'light' ? '#1f1c18' : '#0e0d0b'} />
      <path d="M93 121h77m-77 14h45" stroke="#efe9df" opacity=".4" strokeWidth="2" />
      <circle cx="216" cy="135" r="5" fill={accent} />
      <path d="M216 138v-6m-2 2 2-2 2 2" stroke={mode === 'light' ? '#fff7f0' : '#1c0b07'} strokeWidth="1" fill="none" />
    </svg>
  );
}
