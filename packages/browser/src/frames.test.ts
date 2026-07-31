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
    await Promise.all([
      loop.requestFrame(),
      loop.requestFrame(),
      loop.requestFrame(),
      loop.requestFrame(),
      loop.requestFrame(),
    ]);
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

  it('resolves requestFrame when capture rejects (must not break navigate-style awaits)', async () => {
    let shouldFail = true;
    const capture = async (): Promise<FramePayload> => {
      if (shouldFail) throw new Error('screenshot failed mid-navigation');
      return { dataUrl: 'data:image/jpeg;base64,AAA', width: 100, height: 100 };
    };
    const emitted: unknown[] = [];
    let clock = 0;

    const loop = createFrameLoop({
      capture,
      hasSubscriber: () => true,
      intervalMs: 0,
      now: () => clock,
      emit: (frame) => emitted.push(frame),
    });

    // `navigate()` awaits requestFrame(); a rejecting capture must resolve,
    // not reject the navigation.
    await expect(loop.requestFrame()).resolves.toBeUndefined();
    expect(emitted).toHaveLength(0);

    // The in-flight/pending guards were reset by `finally`, so a later
    // successful capture still flows through.
    shouldFail = false;
    clock = 10;
    await loop.requestFrame();
    expect(emitted).toHaveLength(1);
  });

  it('keeps the loop healthy when a pending request follows a rejecting capture', async () => {
    let captureCount = 0;
    const capture = async (): Promise<FramePayload> => {
      captureCount += 1;
      if (captureCount === 1) throw new Error('boom');
      return { dataUrl: 'data:image/jpeg;base64,AAA', width: 100, height: 100 };
    };
    const emitted: unknown[] = [];

    const loop = createFrameLoop({
      capture,
      hasSubscriber: () => true,
      intervalMs: 0,
      now: () => 0,
      emit: (frame) => emitted.push(frame),
    });

    // The first request starts a capture that rejects; the second marks
    // `pending` while it is in flight. Both must resolve (no unhandled
    // rejection) and the pending drain retries, so the loop is not wedged.
    await expect(Promise.all([loop.requestFrame(), loop.requestFrame()])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(emitted).toHaveLength(1);
    expect(captureCount).toBe(2);
  });
});
