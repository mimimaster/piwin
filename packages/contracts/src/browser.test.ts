import { describe, expect, it } from 'vitest';
import {
  BROWSER_USER_HAS_CONTROL,
  formatTextModelWebElementInjection,
} from './browser.js';

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
