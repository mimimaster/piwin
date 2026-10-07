import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const entryHtml = readFileSync(join(here, '../index.html'), 'utf8');

function bootFaceScript(): string {
  const match = /<script id="boot-splash-face">([\s\S]*?)<\/script>/.exec(entryHtml);
  if (match?.[1] === undefined) {
    throw new Error('entry page has no boot-splash-face script');
  }
  return match[1];
}

type BootEnvironment = {
  appearanceMode?: string;
  lastThemeId?: string;
  systemLight?: boolean;
  storageThrows?: boolean;
};

/** Run the entry page's inline script against a fake window and report the face it picked. */
function resolveBootFace(environment: BootEnvironment): string | undefined {
  const attributes = new Map<string, string>();
  const stored: Record<string, string | undefined> = {
    'piwin.desktop.appearanceMode': environment.appearanceMode,
    'piwin.desktop.lastThemeId': environment.lastThemeId,
  };
  const fakeWindow = {
    localStorage: {
      getItem(key: string): string | null {
        if (environment.storageThrows === true) {
          throw new Error('storage unavailable');
        }
        return stored[key] ?? null;
      },
    },
    matchMedia: (query: string) => ({
      matches: query.includes('light') && environment.systemLight === true,
    }),
  };
  const fakeDocument = {
    documentElement: {
      setAttribute(name: string, value: string): void {
        attributes.set(name, value);
      },
    },
  };
  new Function('window', 'document', bootFaceScript())(fakeWindow, fakeDocument);
  return attributes.get('data-boot-face');
}

describe('boot splash', () => {
  it('ships inside #root so the first React commit removes it', () => {
    expect(entryHtml).toMatch(/<div id="root">\s*<div class="boot-splash"/);
  });

  it('runs before the workbench bundle is requested', () => {
    expect(entryHtml.indexOf('id="boot-splash-face"')).toBeGreaterThan(-1);
    expect(entryHtml.indexOf('id="boot-splash-face"')).toBeLessThan(
      entryHtml.indexOf('src="/src/main.tsx"'),
    );
  });

  it('defaults to the ink face, like the workbench with nothing stored', () => {
    expect(resolveBootFace({})).toBe('ink');
    expect(resolveBootFace({ systemLight: true })).toBe('ink');
  });

  it('follows an explicit appearance mode', () => {
    expect(resolveBootFace({ appearanceMode: 'light', lastThemeId: 'piwin-inkstone-ink' })).toBe('paper');
    expect(resolveBootFace({ appearanceMode: 'dark', lastThemeId: 'piwin-inkstone-paper' })).toBe('ink');
    expect(resolveBootFace({ appearanceMode: 'system', systemLight: true })).toBe('paper');
    expect(resolveBootFace({ appearanceMode: 'system', systemLight: false })).toBe('ink');
  });

  it('falls back to the last applied theme when no mode is stored', () => {
    expect(resolveBootFace({ lastThemeId: 'piwin-inkstone-paper' })).toBe('paper');
    expect(resolveBootFace({ lastThemeId: 'piwin-bone' })).toBe('paper');
    expect(resolveBootFace({ lastThemeId: 'piwin-inkstone-ink' })).toBe('ink');
  });

  it('still paints when storage is unavailable', () => {
    expect(resolveBootFace({ storageThrows: true })).toBe('ink');
  });
});
