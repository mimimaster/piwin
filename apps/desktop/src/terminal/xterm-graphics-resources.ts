import type { Terminal } from '@xterm/xterm';
import type { WebglAddon } from '@xterm/addon-webgl';

type GraphicsLease = {
  pages: Set<HTMLCanvasElement>;
};
const liveGraphics = new Set<GraphicsLease>();

/** Track public canvases only; shared atlas pages stay intact until their last owner leaves. */
export function createXtermGraphicsLease(terminal: Terminal, addon: WebglAddon): {
  capture: () => void;
  dispose: () => void;
} {
  const before = new Set(terminal.element?.querySelectorAll('canvas'));
  const drawingCanvases = new Set<HTMLCanvasElement>();
  const lease: GraphicsLease = { pages: new Set() };
  liveGraphics.add(lease);
  let disposed = false;

  const changeAtlas = (canvas: HTMLCanvasElement): void => {
    lease.pages.clear();
    // A newly attached split pane can inherit an atlas that already has several pages.
    for (const peer of liveGraphics) {
      if (peer !== lease && peer.pages.has(canvas)) {
        for (const page of peer.pages) lease.pages.add(page);
      }
    }
    lease.pages.add(canvas);
  };
  addon.onChangeTextureAtlas(changeAtlas);
  addon.onAddTextureAtlasCanvas((canvas) => { lease.pages.add(canvas); });
  addon.onRemoveTextureAtlasCanvas((canvas) => { lease.pages.delete(canvas); });

  return {
    capture: () => {
      if (disposed) return;
      const atlas = addon.textureAtlas;
      if (atlas !== undefined && !lease.pages.has(atlas)) changeAtlas(atlas);
      // The independent image addon may create its own layer during a resize.
      // Its pictures remain live when the text renderer changes.
      for (const canvas of terminal.element?.querySelectorAll<HTMLCanvasElement>('canvas:not(.xterm-image-layer)') ?? []) {
        if (!before.has(canvas)) drawingCanvases.add(canvas);
      }
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      liveGraphics.delete(lease);
      // Removing a canvas from the DOM alone leaves its backing store alive until GC.
      for (const canvas of drawingCanvases) {
        const context = canvas.getContext('webgl2');
        canvas.width = canvas.height = 0;
        context?.getExtension('WEBGL_lose_context')?.loseContext();
      }
      for (const canvas of lease.pages) {
        if ([...liveGraphics].some((peer) => peer.pages.has(canvas))) continue;
        canvas.width = canvas.height = 0;
      }
      drawingCanvases.clear();
      lease.pages.clear();
    },
  };
}
