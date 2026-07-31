// @vitest-environment happy-dom
/**
 * Regression coverage for the PetSprite animation loop.
 *
 * The loop runs inside a mount-only `useEffect(() => {...}, [])` and is fully
 * ref-driven, so hover interactions must never cancel/restart `requestAnimationFrame`
 * or freeze frame advancement. These tests pin that contract with deterministic
 * rAF/canvas/image/performance stubs so the loop is fully controlled from the test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_PET_STATE_ROWS, type PetRuntimeSnapshot } from '@piwin/contracts';
import { PetSprite } from './PetSprite.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

type DrawArgs = [
  unknown, // image
  number, // sx
  number, // sy (row * cellHeight)
  number, // sw
  number, // sh
  number, // dx
  number, // dy
  number, // dw
  number, // dh
];

function createPet(overrides: Partial<PetRuntimeSnapshot> = {}): PetRuntimeSnapshot {
  return {
    petId: 'test-pet',
    displayName: 'Test Pet',
    spritesheetAbsolutePath: '/tmp/spritesheet.webp',
    state: 'idle',
    fps: 6,
    cellWidth: 192,
    cellHeight: 208,
    cols: 8,
    rows: 9,
    stateRows: { ...DEFAULT_PET_STATE_ROWS },
    ...overrides,
  };
}

/** Fake HTMLImageElement that fires `onload` on the next microtask after `src` is set. */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  private _src = '';
  get src(): string {
    return this._src;
  }
  set src(value: string) {
    this._src = value;
    // The component assigns `onload` after `src`; defer the fire so the handler is set.
    queueMicrotask(() => {
      if (this.onload) this.onload();
    });
  }
}

describe('PetSprite animation loop', () => {
  let container: HTMLDivElement;
  let root: Root;
  let previousActEnvironment: boolean | undefined;

  let rafCallback: ((now: number) => void) | null = null;
  let rafScheduleCount = 0;
  let rafCancelCount = 0;
  let nowValue = 0;
  let drawCalls: DrawArgs[] = [];
  let ctxMock: {
    clearRect: ReturnType<typeof vi.fn>;
    drawImage: ReturnType<typeof vi.fn>;
  };
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;

    rafCallback = null;
    rafScheduleCount = 0;
    rafCancelCount = 0;
    nowValue = 0;
    drawCalls = [];

    vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void): number => {
      rafScheduleCount += 1;
      rafCallback = cb;
      return rafScheduleCount;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
      rafCancelCount += 1;
      void id;
      rafCallback = null;
    });
    vi.stubGlobal('Image', FakeImage);
    vi.spyOn(globalThis.Math, 'random').mockReturnValue(0);
    vi.spyOn(globalThis.performance, 'now').mockImplementation(() => nowValue);

    ctxMock = {
      clearRect: vi.fn(),
      drawImage: vi.fn((...args: unknown[]) => {
        drawCalls.push(args as unknown as DrawArgs);
      }),
    };
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ctxMock) as never;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  function mount(pet: PetRuntimeSnapshot = createPet()): HTMLElement {
    act(() => {
      root.render(<PetSprite pet={pet} />);
    });
    const sprite = container.querySelector<HTMLElement>('.pet-sprite-root');
    if (!sprite) throw new Error('pet-sprite-root not rendered');
    return sprite;
  }

  /** Flush the queued image `onload` microtask so `imageRef` is populated. */
  async function flushImageLoad(): Promise<void> {
    // Two awaits cover the queueMicrotask plus any nested microtask scheduling.
    await Promise.resolve();
    await Promise.resolve();
  }

  function driveFrame(now: number): void {
    nowValue = now;
    const cb = rafCallback;
    if (!cb) throw new Error('no requestAnimationFrame callback pending');
    rafCallback = null;
    // tick mutates refs only; no setState, so no act() needed.
    cb(now);
  }

  function lastDrawSourceY(): number | null {
    if (drawCalls.length === 0) return null;
    return drawCalls[drawCalls.length - 1]![2];
  }

  function hoverEnter(sprite: HTMLElement): void {
    act(() => {
      // React synthesizes onMouseEnter from `mouseover` when relatedTarget is outside.
      sprite.dispatchEvent(
        new MouseEvent('mouseover', { bubbles: true, cancelable: true, relatedTarget: null }),
      );
    });
  }

  function hoverLeave(sprite: HTMLElement): void {
    act(() => {
      sprite.dispatchEvent(
        new MouseEvent('mouseout', { bubbles: true, cancelable: true, relatedTarget: null }),
      );
    });
  }

  it('schedules the loop exactly once on mount and cancels it only on unmount', async () => {
    mount();
    expect(rafScheduleCount).toBe(1);
    expect(rafCancelCount).toBe(0);
    expect(rafCallback).not.toBeNull();

    driveFrame(0);
    driveFrame(16);
    driveFrame(32);
    // Each tick reschedules exactly one new frame; no extra schedules appeared.
    expect(rafScheduleCount).toBe(4);
    expect(rafCancelCount).toBe(0);

    act(() => {
      root.unmount();
    });
    expect(rafCancelCount).toBe(1);
  });

  it('does not cancel or restart the rAF loop on mouse enter/leave', async () => {
    const sprite = mount();
    await flushImageLoad();

    driveFrame(0);
    driveFrame(16);
    const schedulesBeforeHover = rafScheduleCount;
    expect(rafCancelCount).toBe(0);

    hoverEnter(sprite);
    // Hover must not cancel the pending frame or schedule a new burst.
    expect(rafCancelCount).toBe(0);
    expect(rafScheduleCount).toBe(schedulesBeforeHover);
    expect(rafCallback).not.toBeNull();

    hoverLeave(sprite);
    expect(rafCancelCount).toBe(0);
    expect(rafScheduleCount).toBe(schedulesBeforeHover);
    expect(rafCallback).not.toBeNull();

    // The same loop keeps advancing frames after the hover cycle.
    driveFrame(32);
    driveFrame(48);
    expect(rafScheduleCount).toBe(schedulesBeforeHover + 2);
    expect(rafCancelCount).toBe(0);
  });

  it('keeps drawing sprite frames across hover transitions', async () => {
    const sprite = mount();
    await flushImageLoad();

    driveFrame(0);
    driveFrame(16);
    driveFrame(32);
    const drawsBefore = drawCalls.length;
    expect(drawsBefore).toBeGreaterThan(0);

    hoverEnter(sprite);
    hoverLeave(sprite);
    hoverEnter(sprite);
    hoverLeave(sprite);

    driveFrame(48);
    driveFrame(64);
    driveFrame(80);
    expect(drawCalls.length).toBeGreaterThan(drawsBefore);
  });

  it('switches to the waving row on hover enter and returns to idle after the action window', async () => {
    const pet = createPet();
    const cellHeight = pet.cellHeight;
    const sprite = mount(pet);
    await flushImageLoad();

    // Steady-state idle frames (row 0 → sourceY 0).
    driveFrame(0);
    driveFrame(16);
    expect(lastDrawSourceY()).toBe(0);

    // Hover enter while idle arms a `waving` temp action for ACTION_DURATION_MS (1200).
    nowValue = 100;
    hoverEnter(sprite);
    driveFrame(100);
    driveFrame(500);
    expect(lastDrawSourceY()).toBe(pet.stateRows['waving'] * cellHeight);

    // The temp action is expired at the *tail* of the tick (after drawImage), so
    // the fallback to idle only becomes visible on the following frame.
    driveFrame(1400); // > 100 + 1200: expires waving after this draw
    expect(lastDrawSourceY()).toBe(pet.stateRows['waving'] * cellHeight);
    driveFrame(1401);
    expect(lastDrawSourceY()).toBe(0);
    // The loop is still alive and scheduling.
    expect(rafCallback).not.toBeNull();
    expect(rafCancelCount).toBe(0);
  });

  it('does not arm a new idle action while hovered even after the idle interval', async () => {
    const pet = createPet();
    const cellHeight = pet.cellHeight;
    const sprite = mount(pet);
    await flushImageLoad();

    driveFrame(0);
    nowValue = 100;
    hoverEnter(sprite);
    driveFrame(100);
    expect(lastDrawSourceY()).toBe(pet.stateRows['waving'] * cellHeight);

    // Far past the idle interval but still hovered: waving must persist (no random
    // idle action can preempt the hover-armed temp action).
    driveFrame(10_000);
    expect(lastDrawSourceY()).toBe(pet.stateRows['waving'] * cellHeight);

    // Once the waving action expires (tail of the tick after 100 + 1200), the
    // loop falls back to idle — it must NOT arm a fresh idle action while hovered,
    // even though we are far past IDLE_INTERVAL_MS and `Math.random()` is 0.
    driveFrame(10_001); // expiry runs here after the draw
    driveFrame(10_002); // next draw reflects the cleared temp action
    expect(lastDrawSourceY()).toBe(0);
    expect(rafCancelCount).toBe(0);
  });

  it('resets the animation column to 0 when switching states to avoid mid-animation jumps', async () => {
    const pet = createPet();
    const sprite = mount(pet);
    await flushImageLoad();

    // Advance 5 frames in idle mode so frameRef is non-zero
    nowValue = 0;
    driveFrame(0);
    for (let i = 1; i <= 5; i++) {
      nowValue += 200; // > frameMs (166.6ms)
      driveFrame(nowValue);
    }
    // Verify column was non-zero before transition
    const lastDraw = drawCalls[drawCalls.length - 1];
    expect(lastDraw?.[1]).toBeGreaterThan(0);

    // Trigger state change (hover enter -> waving)
    nowValue += 50;
    hoverEnter(sprite);
    driveFrame(nowValue);

    // First frame of waving MUST start at col 0 (sx = 0)
    const newDraw = drawCalls[drawCalls.length - 1];
    expect(newDraw?.[1]).toBe(0);
    expect(newDraw?.[2]).toBe(pet.stateRows['waving'] * pet.cellHeight);
  });
});
