import { describe, expect, it } from 'vitest';
import { EXTENSION_COMPAT_NOTE } from './extension-compat-note.js';

describe('EXTENSION_COMPAT_NOTE', () => {
  it('states the Agent Runtime surface and the TUI gap', () => {
    expect(EXTENSION_COMPAT_NOTE).toMatch(/Agent Runtime/);
    expect(EXTENSION_COMPAT_NOTE).toMatch(/confirm\/select\/input\/notify/);
    expect(EXTENSION_COMPAT_NOTE).toMatch(/\/reload/);
    expect(EXTENSION_COMPAT_NOTE).toMatch(/OS privileges/);
  });
});
