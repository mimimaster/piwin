import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';

const image = vi.hoisted(() => ({ options: undefined as unknown, disposed: 0, broken: false }));
vi.mock('@xterm/addon-image', () => ({
  ImageAddon: class {
    constructor(options: unknown) { image.options = options; }
    dispose(): void { image.disposed += 1; }
  },
}));

import { XTERM_IMAGE_OPTIONS, attachXtermImageAddon } from './xterm-image-addon.js';

function terminal(): { terminal: Terminal; loaded: unknown[] } {
  const loaded: unknown[] = [];
  return {
    loaded,
    terminal: {
      loadAddon: (addon: unknown) => {
        if (image.broken) throw new Error('no canvas');
        loaded.push(addon);
      },
    } as unknown as Terminal,
  };
}

describe('xterm image addon', () => {
  beforeEach(() => { image.options = undefined; image.disposed = 0; image.broken = false; });

  it('loads with iTerm2 support, size reports and bounded memory, and disposes once', () => {
    const { terminal: term, loaded } = terminal();
    const images = attachXtermImageAddon(term);
    expect(images.enabled).toBe(true);
    expect(loaded).toHaveLength(1);
    expect(image.options).toBe(XTERM_IMAGE_OPTIONS);
    expect(XTERM_IMAGE_OPTIONS).toMatchObject({ iipSupport: true, enableSizeReports: true, storageLimit: 64 });
    expect(XTERM_IMAGE_OPTIONS.pixelLimit).toBeLessThanOrEqual(4096 * 4096);
    images.dispose();
    images.dispose();
    expect(image.disposed).toBe(1);
  });

  it('keeps the terminal working without pictures when the addon cannot load', () => {
    image.broken = true;
    const images = attachXtermImageAddon(terminal().terminal);
    expect(images.enabled).toBe(false);
    expect(image.disposed).toBe(1);
    expect(() => images.dispose()).not.toThrow();
  });
});
