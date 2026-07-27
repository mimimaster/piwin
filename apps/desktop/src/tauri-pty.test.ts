import { describe, expect, it } from 'vitest';
import { isTauriPtyAvailable, isTauriRuntime } from './tauri-pty.js';

describe('tauri-pty', () => {
  it('reports non-Tauri runtime in vitest/jsdom', () => {
    expect(isTauriRuntime()).toBe(false);
    expect(isTauriPtyAvailable()).toBe(false);
  });
});
