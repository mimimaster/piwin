import { describe, expect, it } from 'vitest';
import { CANVAS_FIT_FILLS_RATIO, CANVAS_FIT_MAX_SCALE } from './canvas-stage-fit.js';
import { buildCanvasStageFitRuntime } from './srcdoc-canvas-fit.js';

describe('buildCanvasStageFitRuntime', () => {
  it('embeds the shared fit constants and apply hooks', () => {
    const runtime = buildCanvasStageFitRuntime();
    expect(runtime).toContain(`widthRatio >= ${CANVAS_FIT_FILLS_RATIO}`);
    expect(runtime).toContain(`Math.min(scale, ${CANVAS_FIT_MAX_SCALE})`);
    expect(runtime).toContain('data-piwin-canvas-fit');
    expect(runtime).toContain('startCanvasStageFit');
    expect(runtime).toContain('scheduleCanvasStageFit');
    expect(() => new Function(runtime)).not.toThrow();
  });
});
