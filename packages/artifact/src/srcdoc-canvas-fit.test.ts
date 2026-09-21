import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CANVAS_FIT_COVER_MIN_VISIBLE_RATIO,
  CANVAS_FIT_FILLS_RATIO,
  CANVAS_FIT_MAX_SCALE,
} from './canvas-stage-fit.js';
import { buildCanvasStageFitRuntime } from './srcdoc-canvas-fit.js';

describe('buildCanvasStageFitRuntime', () => {
  it('embeds the shared fit constants and apply hooks', () => {
    const runtime = buildCanvasStageFitRuntime();
    expect(runtime).toContain(`widthRatio >= ${CANVAS_FIT_FILLS_RATIO}`);
    expect(runtime).toContain(`Math.min(scale, ${CANVAS_FIT_MAX_SCALE})`);
    expect(runtime).toContain('data-piwin-canvas-fit');
    expect(runtime).toContain('data-piwin-canvas-aspect');
    expect(runtime).toContain(`visible >= ${CANVAS_FIT_COVER_MIN_VISIBLE_RATIO}`);
    expect(runtime).toContain('applyCanvasDesignBoxes');
    expect(runtime).toContain('startCanvasStageFit');
    expect(runtime).toContain('scheduleCanvasStageFit');
    expect(() => new Function(runtime)).not.toThrow();
  });

  it('never scales overlay controls or children of a full-width stage', () => {
    const runtime = buildCanvasStageFitRuntime();
    expect(runtime).toContain('isOverlayFitNode');
    expect(runtime).toContain('!stageFillsWidth');
  });
});

type FakeSvg = {
  attributes: Map<string, string>;
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  getBoundingClientRect: () => { width: number; height: number };
};

function createFakeSvg(input: {
  viewBox: string | null;
  preserveAspectRatio: string | null;
  width: number;
  height: number;
}): FakeSvg {
  const attributes = new Map<string, string>();
  if (input.viewBox !== null) attributes.set('viewBox', input.viewBox);
  if (input.preserveAspectRatio !== null) {
    attributes.set('preserveAspectRatio', input.preserveAspectRatio);
  }
  return {
    attributes,
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => {
      attributes.set(name, value);
    },
    removeAttribute: (name) => {
      attributes.delete(name);
    },
    getBoundingClientRect: () => ({ width: input.width, height: input.height }),
  };
}

/** Runs the real runtime against a minimal document/window stub. */
function runCanvasFit(
  mode: 'canvas' | 'inline',
  svgs: FakeSvg[],
  viewport: { width: number; height: number },
): { applyCanvasStageFit: () => void; resetCanvasDesignBoxes: () => void } {
  const documentStub = {
    body: {},
    documentElement: null,
    querySelector: () => null,
    querySelectorAll: (selector: string) => (selector === 'svg' ? svgs : []),
  };
  vi.stubGlobal('document', documentStub);
  vi.stubGlobal('window', { innerWidth: viewport.width, innerHeight: viewport.height });
  const source = `var currentFrameMode = ${JSON.stringify(mode)};
${buildCanvasStageFitRuntime()}
;return { applyCanvasStageFit: applyCanvasStageFit, resetCanvasDesignBoxes: resetCanvasDesignBoxes };`;
  return new Function(source)() as {
    applyCanvasStageFit: () => void;
    resetCanvasDesignBoxes: () => void;
  };
}

describe('canvas runtime design-box letterboxing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('swaps slice for meet on the SVG that paints a cropped canvas', () => {
    const scene = createFakeSvg({
      viewBox: '0 0 1000 600',
      preserveAspectRatio: 'xMidYMid slice',
      width: 500,
      height: 810,
    });
    const run = runCanvasFit('canvas', [scene], { width: 500, height: 810 });

    run.applyCanvasStageFit();

    expect(scene.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    expect(scene.getAttribute('data-piwin-canvas-aspect')).toBe('letterbox');

    run.resetCanvasDesignBoxes();
    expect(scene.getAttribute('preserveAspectRatio')).toBe('xMidYMid slice');
    expect(scene.getAttribute('data-piwin-canvas-aspect')).toBeNull();
  });

  it('leaves inline mode and matching aspects alone', () => {
    const scene = createFakeSvg({
      viewBox: '0 0 1000 600',
      preserveAspectRatio: 'xMidYMid slice',
      width: 500,
      height: 810,
    });
    runCanvasFit('inline', [scene], { width: 500, height: 810 }).applyCanvasStageFit();
    expect(scene.getAttribute('preserveAspectRatio')).toBe('xMidYMid slice');

    const matches = createFakeSvg({
      viewBox: '0 0 1000 600',
      preserveAspectRatio: 'xMidYMid slice',
      width: 500,
      height: 300,
    });
    runCanvasFit('canvas', [matches], { width: 500, height: 810 }).applyCanvasStageFit();
    // Not full-bleed: an inline illustration inside a scrolling canvas.
    expect(matches.getAttribute('preserveAspectRatio')).toBe('xMidYMid slice');
  });
});
