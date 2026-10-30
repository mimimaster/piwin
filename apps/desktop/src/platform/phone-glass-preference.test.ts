// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parsePhoneGlass } from './ui-preferences.js';
import { applyWindowMaterialToDocument } from './window-material-preferences.js';

describe('phone glass preference', () => {
  it('parses 0–100 and rejects junk', () => {
    expect(parsePhoneGlass(null)).toBeUndefined();
    expect(parsePhoneGlass('')).toBeUndefined();
    expect(parsePhoneGlass('abc')).toBeUndefined();
    expect(parsePhoneGlass('55')).toBe(55);
    expect(parsePhoneGlass('140')).toBe(100);
    expect(parsePhoneGlass('-3')).toBe(0);
  });

  it('writes --phone-glass-strength, full glass by default', () => {
    const root = document.createElement('div');
    applyWindowMaterialToDocument(root, undefined);
    expect(root.style.getPropertyValue('--phone-glass-strength')).toBe('1');
    applyWindowMaterialToDocument(root, undefined, 40);
    expect(root.style.getPropertyValue('--phone-glass-strength')).toBe('0.4');
  });
});
