// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';

type AddonProbe = {
  textureAtlas: HTMLCanvasElement | undefined;
  disposed: boolean;
  addPage: (canvas: HTMLCanvasElement) => void;
  removePage: (canvas: HTMLCanvasElement) => void;
};
const webgl = vi.hoisted(() => ({
  addons: [] as AddonProbe[],
  atlas: undefined as HTMLCanvasElement | undefined,
}));
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class implements AddonProbe {
    textureAtlas = webgl.atlas;
    disposed = false;
    addPage: (canvas: HTMLCanvasElement) => void = () => undefined;
    removePage: (canvas: HTMLCanvasElement) => void = () => undefined;
    constructor() { webgl.addons.push(this); }
    onContextLoss(): void { /* This test drives the memory governor instead. */ }
    onChangeTextureAtlas(): void { /* The shared atlas is set before activation. */ }
    onAddTextureAtlasCanvas(listener: (canvas: HTMLCanvasElement) => void): void { this.addPage = listener; }
    onRemoveTextureAtlasCanvas(listener: (canvas: HTMLCanvasElement) => void): void { this.removePage = listener; }
    clearTextureAtlas(): void { /* This test requires disposal, not a clear. */ }
    dispose(): void { this.disposed = true; }
  },
}));

import { globalMemoryGovernor } from '../notes/memory-governor.js';
import { attachXtermWebglRenderer, type XtermRenderer } from './xterm-webgl-renderer.js';

const renderers: XtermRenderer[] = [];

function terminalProbe(imageCanvas?: HTMLCanvasElement) {
  const element = document.createElement('div');
  const loseContext = vi.fn();
  const context = { getExtension: () => ({ loseContext }) };
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as WebGL2RenderingContext);
  const loadAddon = vi.fn(() => {
    element.append(canvas);
    if (imageCanvas !== undefined) element.append(imageCanvas);
  });
  const refresh = vi.fn();
  const terminal = { element, loadAddon, refresh, rows: 24 } as unknown as Terminal;
  return { terminal, loadAddon, refresh, canvas, loseContext };
}

function attach(terminal: Terminal): XtermRenderer {
  const renderer = attachXtermWebglRenderer(terminal);
  renderers.push(renderer);
  return renderer;
}

afterEach(() => {
  for (const renderer of renderers.splice(0)) renderer.dispose();
  globalMemoryGovernor.reset();
  webgl.addons = [];
  webgl.atlas = undefined;
  vi.restoreAllMocks();
});

describe('xterm graphics under critical memory pressure', () => {
  it('releases drawing resources without replacing the live terminal, then restores only at normal pressure', () => {
    webgl.atlas = document.createElement('canvas');
    const pane = terminalProbe();
    const renderer = attach(pane.terminal);
    globalMemoryGovernor.setLevel('critical');
    expect(renderer.kind).toBe('dom');
    expect(webgl.addons[0]?.disposed).toBe(true);
    expect(pane.loseContext).toHaveBeenCalledOnce();
    expect([pane.canvas.width, pane.canvas.height]).toEqual([0, 0]);
    expect(pane.refresh).toHaveBeenCalledWith(0, 23);
    globalMemoryGovernor.setLevel('moderate');
    expect(pane.loadAddon).toHaveBeenCalledTimes(1);
    globalMemoryGovernor.setLevel('normal');
    expect(renderer.kind).toBe('webgl');
    expect(pane.loadAddon).toHaveBeenCalledTimes(2);
  });

  it('does not allocate a WebGL addon for a pane opened while critical', () => {
    globalMemoryGovernor.setLevel('critical');
    const pane = terminalProbe();
    const renderer = attach(pane.terminal);
    expect(renderer.kind).toBe('dom');
    expect(pane.loadAddon).not.toHaveBeenCalled();
    globalMemoryGovernor.setLevel('normal');
    expect(pane.loadAddon).toHaveBeenCalledOnce();
  });

  it('keeps a shared multi-page atlas intact until the last drawing owner releases it', () => {
    const atlas = document.createElement('canvas');
    const extraPage = document.createElement('canvas');
    atlas.width = extraPage.width = 512;
    webgl.atlas = atlas;
    const first = attach(terminalProbe().terminal);
    webgl.addons[0]?.addPage(extraPage);
    const second = attach(terminalProbe().terminal);
    first.dispose();
    expect(atlas.width).toBe(512);
    expect(extraPage.width).toBe(512);
    second.dispose();
    expect(atlas.width).toBe(0);
    expect(extraPage.width).toBe(0);
  });

  it('does not reactivate a disposed pane on recovery', () => {
    const pane = terminalProbe();
    const renderer = attach(pane.terminal);
    globalMemoryGovernor.setLevel('critical');
    renderer.dispose();
    globalMemoryGovernor.setLevel('normal');
    expect(pane.loadAddon).toHaveBeenCalledOnce();
  });

  it('preserves the independent image layer even if it appears while the renderer loads', () => {
    const image = document.createElement('canvas');
    image.className = 'xterm-image-layer';
    image.width = 640;
    image.height = 480;
    const getContext = vi.spyOn(image, 'getContext');
    const pane = terminalProbe(image);
    attach(pane.terminal);
    globalMemoryGovernor.setLevel('critical');
    expect([image.width, image.height]).toEqual([640, 480]);
    expect(getContext).not.toHaveBeenCalled();
    expect(pane.loseContext).toHaveBeenCalledOnce();
  });

  it('shares remaining atlas pages after an atlas merge changes the first public canvas', () => {
    const original = document.createElement('canvas');
    const remaining = document.createElement('canvas');
    const extra = document.createElement('canvas');
    remaining.width = extra.width = 512;
    webgl.atlas = original;
    const first = attach(terminalProbe().terminal);
    const addon = webgl.addons[0];
    if (addon === undefined) throw new Error('missing first addon');
    addon.addPage(remaining);
    addon.addPage(extra);
    addon.removePage(original);
    addon.textureAtlas = remaining;
    webgl.atlas = remaining;
    const second = attach(terminalProbe().terminal);
    first.dispose();
    expect(remaining.width).toBe(512);
    expect(extra.width).toBe(512);
    second.dispose();
    expect(remaining.width).toBe(0);
    expect(extra.width).toBe(0);
  });
});
