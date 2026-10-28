// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { injectLaunchSplash } from './inject-launch-splash.js';

const here = dirname(fileURLToPath(import.meta.url));
const controllerSource = readFileSync(join(here, 'launch-splash.js'), 'utf8');
const markup = readFileSync(join(here, 'launch-splash.html'), 'utf8');
const SHOWN_KEY = 'piwin.launch-splash.shown';

const ENTRY = [
  '<!doctype html><html><head><title>t</title></head>',
  '<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
].join('');

describe('injectLaunchSplash', () => {
  it('puts the style in <head> and the splash after #root, before </body>', () => {
    const html = injectLaunchSplash(ENTRY);
    const styleAt = html.indexOf('id="launch-splash-style"');
    const headCloseAt = html.indexOf('</head>');
    const rootAt = html.indexOf('id="root"');
    const splashAt = html.indexOf('id="launch-splash"');
    const scriptAt = html.indexOf('id="launch-splash-script"');
    expect(styleAt).toBeGreaterThan(-1);
    expect(styleAt).toBeLessThan(headCloseAt);
    expect(splashAt).toBeGreaterThan(rootAt);
    expect(scriptAt).toBeGreaterThan(splashAt);
    expect(scriptAt).toBeLessThan(html.indexOf('</body>'));
  });

  it('is idempotent', () => {
    const once = injectLaunchSplash(ENTRY);
    expect(injectLaunchSplash(once)).toBe(once);
  });

  it('rejects a page without head/body', () => {
    expect(() => injectLaunchSplash('<div></div>')).toThrow(/head/);
  });
});

describe('launch splash controller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.sessionStorage.clear();
    document.documentElement.removeAttribute('data-boot-face');
    document.documentElement.setAttribute('data-face', 'paper');
    document.head.innerHTML = '<style id="launch-splash-style"></style>';
    document.body.innerHTML = `<div id="root"></div>${markup}`;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function boot(): void {
    // Same as the inline <script>: run once against the live document.
    new Function(controllerSource)();
  }

  function splash(): HTMLElement | null {
    return document.getElementById('launch-splash');
  }

  async function mountApp(className = 'app'): Promise<void> {
    const node = document.createElement('div');
    node.className = className;
    document.getElementById('root')?.replaceChildren(node);
    await vi.advanceTimersByTimeAsync(0);
  }

  it('waits for the stamp to finish even when the app mounts at once', async () => {
    boot();
    await mountApp();
    await vi.advanceTimersByTimeAsync(1000);
    expect(splash()?.className).not.toContain('is-leaving');
    await vi.advanceTimersByTimeAsync(700);
    expect(splash()?.className).toContain('is-leaving');
    await vi.advanceTimersByTimeAsync(700);
    expect(splash()).toBeNull();
    expect(document.getElementById('launch-splash-style')).toBeNull();
    expect(window.sessionStorage.getItem(SHOWN_KEY)).toBe('1');
  });

  it('ignores the desktop boot placeholder inside #root', async () => {
    boot();
    await mountApp('boot-splash');
    await vi.advanceTimersByTimeAsync(2500);
    expect(splash()?.className).not.toContain('is-leaving');
    expect(splash()?.className).toContain('is-waiting');
    await mountApp('workbench');
    await vi.advanceTimersByTimeAsync(100);
    expect(splash()?.className).toContain('is-leaving');
  });

  it('plays the quick version on a same-session reload', async () => {
    window.sessionStorage.setItem(SHOWN_KEY, '1');
    boot();
    expect(splash()?.className).toContain('is-quick');
    await mountApp();
    await vi.advanceTimersByTimeAsync(400);
    expect(splash()?.className).toContain('is-leaving');
  });

  it('adopts the face chosen by the entry page', async () => {
    document.documentElement.setAttribute('data-boot-face', 'ink');
    boot();
    await vi.advanceTimersByTimeAsync(20);
    expect(splash()?.getAttribute('data-face')).toBe('ink');
  });

  it('removes itself after the fail-safe when the app never boots', async () => {
    boot();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(splash()?.className).toContain('is-leaving');
    await vi.advanceTimersByTimeAsync(700);
    expect(splash()).toBeNull();
  });
});
