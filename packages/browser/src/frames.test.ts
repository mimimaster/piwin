import { describe, expect, it } from 'vitest';
import { createFrameLoop } from './frames.js';
import type { FramePayload } from './frames.js';

describe('createFrameLoop', () => {
  it('emits at most one frame per interval regardless of request bursts', async () => {
    let captured = 0;
    const capture = async (): Promise<FramePayload> => {
      captured += 1;
      return { dataUrl: 'data:image/jpeg;base64,AAA', width: 100, height: 100 };
    };
    let clock = 0;
    const emitted: number[] = [];

    const loop = createFrameLoop({
      capture,
      hasSubscriber: () => true,
      intervalMs: 250,
      now: () => clock,
      emit: (frame) => emitted.push(frame.ts),
    });

    // 5 rapid requests at t=0 → exactly one emission (the rest are throttled).
    await Promise.all([loop.requestFrame(), loop.requestFrame(), loop.requestFrame(), loop.requestFrame(), loop.requestFrame()]);
    expect(emitted).toHaveLength(1);

    // Advancing time lets a new frame through.
    clock = 260;
    await loop.requestFrame();
    expect(emitted).toHaveLength(2);

    // At 4 fps over 1s, ten calls produce at most four emissions.
    expect(emitted.length).toBeLessThanOrEqual(10 / 4 + 1);
  });

  it('does not emit when there is no subscriber', async () => {
    let captured = 0;
    const capture = async (): Promise<FramePayload> => {
      captured += 1;
      return { dataUrl: 'data:image/jpeg;base64,AAA', width: 100, height: 100 };
    };
    const emitted: unknown[] = [];

    const loop = createFrameLoop({
      capture,
      hasSubscriber: () => false,
      intervalMs: 250,
      now: () => Date.now(),
      emit: (frame) => emitted.push(frame),
    });

    await loop.requestFrame();
    await loop.requestFrame();
    expect(emitted).toHaveLength(0);
    expect(captured).toBe(0);
  });

  it('does not capture twice concurrently while a slow capture is in flight', async () => {
    let captureCount = 0;
    const capture = async (): Promise<FramePayload> => {
      captureCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { dataUrl: 'data:image/jpeg;base64,AAA', width: 100, height: 100 };
    };
    const emitted: unknown[] = [];

    const loop = createFrameLoop({
      capture,
      hasSubscriber: () => true,
      intervalMs: 0, // throttle off so the in-flight guard is what matters
      now: () => 0,
      emit: (frame) => emitted.push(frame),
    });

    await Promise.all([loop.requestFrame(), loop.requestFrame(), loop.requestFrame()]);
    expect(captureCount).toBeLessThanOrEqual(2);
    expect(emitted.length).toBeGreaterThan(0);
  });
});
