/**
 * App-shell CSS vars from DesktopPreferences + live panel widths.
 */
import type { CSSProperties } from 'react';
import { resolveConversationWidth, type DesktopPreferences } from './ui-preferences';

export function desktopPreferencesCssVars(preferences: DesktopPreferences): CSSProperties {
  const chatFontSize =
    preferences.assistantTextSize === 'small'
      ? '13px'
      : preferences.assistantTextSize === 'large'
        ? '17px'
        : '14.5px';
  const codeFontSize =
    preferences.codeTextSize === 'small'
      ? '11.5px'
      : preferences.codeTextSize === 'large'
        ? '14.5px'
        : '12.5px';
  return {
    '--chat-font-size': chatFontSize,
    '--code-font-size': codeFontSize,
    '--code-wrap': preferences.codeWrap ? 'break-word' : 'unset',
    '--conversation-width': resolveConversationWidth(preferences.conversationWidth),
    // Resolve on the preference owner: a :root alias otherwise freezes the
    // nested width variable before the user's shell override is inherited.
    '--chat-max': 'min(100%, var(--conversation-width))',
  } as CSSProperties;
}

export function appShellCssVars(input: {
  preferencesStyle: CSSProperties;
  sidebarWidthPx: number;
  sidebarResizing: boolean;
  rightPanelWidthPx: number;
  rightPanelResizing: boolean;
}): CSSProperties {
  return {
    ...input.preferencesStyle,
    ...(input.sidebarResizing ? {} : { '--sidebar-width': `${input.sidebarWidthPx}px` }),
    ...(input.rightPanelResizing ? {} : { '--right-panel-width': `${input.rightPanelWidthPx}px` }),
  } as CSSProperties;
}
