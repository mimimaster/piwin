import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';

const webgl = vi.hoisted(() => ({
  contextLost: undefined as (() => void) | undefined,
  disposed: 0,
  cleared: 0,
  unsupported: false,
}));
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    onContextLoss(listener: () => void): void { webgl.contextLost = listener; }
    clearTextureAtlas(): void { webgl.cleared += 1; }
    dispose(): void { webgl.disposed += 1; }
  },
}));

import { attachXtermWebglRenderer } from './xterm-webgl-renderer.js';

function terminal(): Terminal {
  return {
    loadAddon: () => { if (webgl.unsupported) throw new Error('WebGL2 not supported'); },
  } as unknown as Terminal;
}

describe('xterm WebGL renderer', () => {
  beforeEach(() => { webgl.contextLost = undefined; webgl.disposed = 0; webgl.cleared = 0; webgl.unsupported = false; });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('clears the shared atlas for every live terminal at once when fonts load', async () => {
    let fontsLoaded = (): void => undefined;
    const ready = new Promise<void>((resolve) => { fontsLoaded = resolve; });
    vi.stubGlobal('document', { fonts: { status: 'loading', ready } });
    const first = attachXtermWebglRenderer(terminal());
    const second = attachXtermWebglRenderer(terminal());
    const gone = attachXtermWebglRenderer(terminal());
    gone.dispose();
    fontsLoaded();
    await ready;
    await Promise.resolve();
    // Split panes share one atlas: clearing it for only one pane garbles the others.
    expect(webgl.cleared).toBe(2);
    first.dispose();
    second.dispose();
  });

  it('leaves the atlas alone when fonts were already loaded', async () => {
    vi.stubGlobal('document', { fonts: { status: 'loaded', ready: Promise.resolve() } });
    const renderer = attachXtermWebglRenderer(terminal());
    await Promise.resolve();
    expect(webgl.cleared).toBe(0);
    renderer.dispose();
  });

  it('renders on the GPU and releases the addon once', () => {
    const renderer = attachXtermWebglRenderer(terminal());
    expect(renderer.kind).toBe('webgl');
    renderer.dispose();
    renderer.dispose();
    expect(webgl.disposed).toBe(1);
  });

  it('stays on the DOM renderer when the webview has no WebGL2', () => {
    webgl.unsupported = true;
    const renderer = attachXtermWebglRenderer(terminal());
    expect(renderer.kind).toBe('dom');
    expect(webgl.disposed).toBe(1);
  });

  it('hands rendering back to the DOM renderer when the context is lost', () => {
    const renderer = attachXtermWebglRenderer(terminal());
    webgl.contextLost?.();
    expect(webgl.disposed).toBe(1);
    renderer.dispose();
    expect(webgl.disposed).toBe(1);
  });
});
