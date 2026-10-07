import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

function readSheet(relativePath: string): string {
  return readFileSync(join(here, relativePath), 'utf8');
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const PHONE_SHEETS = [
  'region-phone.css',
  'region-phone-edge.css',
  'region-phone-touch.css',
  'region-phone-settings.css',
] as const;

/**
 * Layout tokens the phone sheets set, and the sheets that must read them.
 * A theme rule that pins this geometry with a literal again silently wins
 * over the phone layout, so each consumer is checked for the var() read.
 */
const TOKEN_CONSUMERS: Record<string, readonly string[]> = {
  '--shell-frame-padding': ['inkstone/shell.css', 'region-shell.css'],
  '--shell-frame-gap': ['inkstone/shell.css'],
  '--shell-titleband-row': ['inkstone/shell.css'],
  '--shell-panel-radius': ['inkstone/shell.css'],
  '--shell-panel-shadow': ['inkstone/shell.css'],
  '--drawer-inset-top': ['inkstone/shell.css'],
  '--drawer-inset-bottom': ['inkstone/shell.css'],
  '--inspector-inset-top': ['inkstone/shell.css'],
  '--titleband-box-height': ['inkstone/titlebar.css', 'region-context-bar.css'],
  '--titleband-padding': ['inkstone/titlebar.css', 'region-context-bar.css'],
  '--titleband-btn-size': ['inkstone/titlebar.css', 'region-context-bar.css'],
  '--session-tree-trigger-size': ['inkstone/titlebar.css'],
  '--composer-input-min-height': ['inkstone/composer.css'],
  '--composer-input-font-size': ['inkstone/composer.css'],
  '--sb-top-control-size': ['inkstone/sidebar-chrome.css'],
  '--inspector-action-size': ['inkstone/inspector.css'],
  '--subpage-titleband-box-height': ['inkstone/subpages.css'],
  '--subpage-titleband-padding': ['inkstone/subpages.css'],
};

describe('phone layout contract', () => {
  it.each(PHONE_SHEETS)('%s carries no !important', (sheet) => {
    // The phone layout wins through tokens the theme sheets read, never by
    // out-weighing them: a weighted override breaks on the next theme edit.
    expect(stripComments(readSheet(sheet))).not.toContain('!important');
  });

  it.each(Object.entries(TOKEN_CONSUMERS))('%s is set by a phone sheet and read by its consumers', (token, consumers) => {
    const phoneCss = PHONE_SHEETS.map((sheet) => stripComments(readSheet(sheet))).join('\n');
    expect(phoneCss).toContain(`${token}:`);
    for (const consumer of consumers) {
      expect(stripComments(readSheet(consumer)), `${consumer} must read ${token}`).toContain(
        `var(${token}`,
      );
    }
  });

  it('loads the phone settings sheet after every settings sheet', () => {
    // settings.css is deferred with SettingsPanel, so it enters the cascade
    // after styles.css. The phone sheet refines it by order and must be last.
    const imports = [...stripComments(readSheet('settings.css')).matchAll(/@import '([^']+)';/g)].map(
      (match) => match[1],
    );
    expect(imports.at(-1)).toBe('./region-phone-settings.css');
    expect(stripComments(readSheet('../styles.css'))).not.toContain('region-phone-settings.css');
  });
});
