import { describe, expect, it } from 'vitest';
import { isDesktopShellRuntime } from './pick-project-directory';

describe('pick-project-directory', () => {
  it('detects non-Tauri (browser / vite) as non-desktop shell', () => {
    expect(isDesktopShellRuntime()).toBe(false);
  });
});
