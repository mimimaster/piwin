import { describe, expect, it } from 'vitest';
import {
  BROWSER_ACTION_FAILED,
  BROWSER_AGENT_HAS_CONTROL,
  BROWSER_DEFAULT_VIEWPORT_HEIGHT,
  BROWSER_DEFAULT_VIEWPORT_WIDTH,
  BROWSER_OPERATION_INTERRUPTED,
  BROWSER_RUNTIME_GONE,
  BROWSER_STALE_TARGET,
  BROWSER_UNAVAILABLE,
  BROWSER_USER_HAS_CONTROL,
  formatTextModelWebElementInjection,
  type BrowserRuntimeState,
} from './browser.js';
import { isHostToolPermissionAction } from './tool-registration.js';

describe('formatTextModelWebElementInjection', () => {
  it('formats url selector and bounded text', () => {
    const text = formatTextModelWebElementInjection({
      id: 'e1',
      kind: 'web-element',
      url: 'https://example.com/page',
      selector: 'button.submit',
      text: 'Submit order',
    });
    expect(text).toContain('[attached web element]');
    expect(text).toContain('url: https://example.com/page');
    expect(text).toContain('selector: button.submit');
    expect(text).toContain('text: Submit order');
    expect(text).not.toContain('html:');
    expect(text).not.toContain('screenshot path:');
  });

  it('includes optional html and screenshot path when present', () => {
    const text = formatTextModelWebElementInjection({
      id: 'e1',
      kind: 'web-element',
      url: 'https://example.com',
      selector: 'nav a',
      text: 'link',
      html: '<a href="/x">link</a>',
      screenshotPath: '/Users/me/.piwin/media/s1/e1.png',
    });
    expect(text).toContain('html: <a href="/x">link</a>');
    expect(text).toContain('screenshot path: /Users/me/.piwin/media/s1/e1.png');
  });

  it('truncates text beyond the byte budget', () => {
    const longText = 'x'.repeat(4 * 1024);
    const text = formatTextModelWebElementInjection({
      id: 'e1',
      kind: 'web-element',
      url: 'https://example.com',
      selector: 'div',
      text: longText,
    });
    expect(text).toContain(`text: ${'x'.repeat(2 * 1024)}…`);
    expect(text).not.toContain('x'.repeat(2 * 1024 + 1));
  });
});

describe('browser workbench contracts (ADR 0057)', () => {
  it('exports a stable user-has-control error code', () => {
    expect(BROWSER_USER_HAS_CONTROL).toBe('browser-user-has-control');
  });
});

describe('browser runtime contracts (completeness plan §4)', () => {
  it('exports distinct failure codes', () => {
    const codes = [
      BROWSER_RUNTIME_GONE,
      BROWSER_UNAVAILABLE,
      BROWSER_STALE_TARGET,
      BROWSER_ACTION_FAILED,
      BROWSER_OPERATION_INTERRUPTED,
      BROWSER_AGENT_HAS_CONTROL,
      BROWSER_USER_HAS_CONTROL,
    ];
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('defaults the logical viewport to 1280x800', () => {
    expect(BROWSER_DEFAULT_VIEWPORT_WIDTH).toBe(1280);
    expect(BROWSER_DEFAULT_VIEWPORT_HEIGHT).toBe(800);
  });

  it('accepts a stopped runtime snapshot without optional identity', () => {
    const state: BrowserRuntimeState = {
      lifecycle: 'stopped',
      mirror: 'off',
      generation: 0,
      viewport: {
        mode: 'fixed',
        width: BROWSER_DEFAULT_VIEWPORT_WIDTH,
        height: BROWSER_DEFAULT_VIEWPORT_HEIGHT,
      },
      recoveryCount: 0,
    };
    expect(state.pageId).toBeUndefined();
  });

  it('includes installing as a first-use Chromium download lifecycle', () => {
    const state: BrowserRuntimeState = {
      lifecycle: 'installing',
      mirror: 'off',
      generation: 0,
      viewport: {
        mode: 'fixed',
        width: BROWSER_DEFAULT_VIEWPORT_WIDTH,
        height: BROWSER_DEFAULT_VIEWPORT_HEIGHT,
      },
      recoveryCount: 0,
    };
    expect(state.lifecycle).toBe('installing');
  });

  it('registers status restart and viewport permission actions', () => {
    expect(isHostToolPermissionAction('browser:status')).toBe(true);
    expect(isHostToolPermissionAction('browser:restart')).toBe(true);
    expect(isHostToolPermissionAction('browser:viewport')).toBe(true);
  });
});
