import { describe, expect, it, vi } from 'vitest';
import {
  createRendererSelfHeal,
  SELF_HEAL_COOLDOWN_MS,
  SELF_HEAL_HIDDEN_HOLD_MS,
  SELF_HEAL_MAX_BYTES,
  SELF_HEAL_PRESSURE_COOLDOWN_MS,
  SELF_HEAL_RECLAIM_BYTES,
  SELF_HEAL_UNFOCUSED_HOLD_MS,
  shouldRelaunchRenderer,
  type RendererSelfHealDeps,
} from './renderer-self-heal';

const FAT = SELF_HEAL_RECLAIM_BYTES;
const HIDDEN_READY = {
  bytes: FAT,
  runActive: false,
  protectedWork: false,
  documentHidden: true,
  windowFocused: false,
  hiddenSinceMs: 0,
  unfocusedSinceMs: 0,
  lastAttemptAtMs: null,
  nowMs: SELF_HEAL_HIDDEN_HOLD_MS,
};

describe('shouldRelaunchRenderer', () => {
  it('ignores invalid footprint samples', () => {
    for (const bytes of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(shouldRelaunchRenderer({ ...HIDDEN_READY, bytes })).toBe(false);
    }
  });
  it('fires after the window has been hidden long enough once footprint is fat', () => {
    expect(shouldRelaunchRenderer(HIDDEN_READY)).toBe(true);
    expect(shouldRelaunchRenderer({ ...HIDDEN_READY, nowMs: SELF_HEAL_HIDDEN_HOLD_MS - 1 })).toBe(
      false,
    );
  });

  it('fires after a longer unfocused hold even when the document stays visible', () => {
    expect(
      shouldRelaunchRenderer({
        ...HIDDEN_READY,
        documentHidden: false,
        hiddenSinceMs: null,
        unfocusedSinceMs: 0,
        nowMs: SELF_HEAL_UNFOCUSED_HOLD_MS,
      }),
    ).toBe(true);
    expect(
      shouldRelaunchRenderer({
        ...HIDDEN_READY,
        documentHidden: false,
        hiddenSinceMs: null,
        unfocusedSinceMs: 0,
        nowMs: SELF_HEAL_UNFOCUSED_HOLD_MS - 1,
      }),
    ).toBe(false);
  });

  it('does not fire for a healthy footprint or while the user is looking', () => {
    expect(shouldRelaunchRenderer({ ...HIDDEN_READY, bytes: FAT - 1 })).toBe(false);
    expect(shouldRelaunchRenderer({ ...HIDDEN_READY, bytes: null })).toBe(false);
    expect(
      shouldRelaunchRenderer({
        ...HIDDEN_READY,
        documentHidden: false,
        windowFocused: true,
        hiddenSinceMs: null,
        unfocusedSinceMs: null,
      }),
    ).toBe(false);
  });

  it('defers ordinary background recycling during a streaming run', () => {
    expect(shouldRelaunchRenderer({ ...HIDDEN_READY, runActive: true })).toBe(false);
  });

  it('reclaims a focused streaming renderer at the memory budget', () => {
    const active = {
      ...HIDDEN_READY,
      runActive: true,
      documentHidden: false,
      windowFocused: true,
      hiddenSinceMs: null,
      unfocusedSinceMs: null,
    };
    expect(shouldRelaunchRenderer({ ...active, bytes: SELF_HEAL_MAX_BYTES - 1 })).toBe(false);
    expect(shouldRelaunchRenderer({ ...active, bytes: SELF_HEAL_MAX_BYTES })).toBe(true);
  });

  it('protects local work regardless of footprint and background eligibility', () => {
    expect(shouldRelaunchRenderer({ ...HIDDEN_READY, protectedWork: true })).toBe(false);
    expect(
      shouldRelaunchRenderer({
        ...HIDDEN_READY,
        bytes: 4 * SELF_HEAL_MAX_BYTES,
        protectedWork: true,
      }),
    ).toBe(false);
  });

  it('uses a shorter cooldown for an over-budget renderer', () => {
    const high = { ...HIDDEN_READY, bytes: SELF_HEAL_MAX_BYTES, lastAttemptAtMs: 0 };
    expect(shouldRelaunchRenderer({ ...high, nowMs: SELF_HEAL_PRESSURE_COOLDOWN_MS - 1 })).toBe(
      false,
    );
    expect(shouldRelaunchRenderer({ ...high, nowMs: SELF_HEAL_PRESSURE_COOLDOWN_MS })).toBe(true);
  });

  it('respects the attempt cooldown', () => {
    const nowMs = SELF_HEAL_HIDDEN_HOLD_MS + SELF_HEAL_COOLDOWN_MS;
    expect(
      shouldRelaunchRenderer({
        ...HIDDEN_READY,
        nowMs,
        lastAttemptAtMs: nowMs - SELF_HEAL_COOLDOWN_MS + 1,
      }),
    ).toBe(false);
    expect(
      shouldRelaunchRenderer({
        ...HIDDEN_READY,
        nowMs,
        lastAttemptAtMs: nowMs - SELF_HEAL_COOLDOWN_MS,
      }),
    ).toBe(true);
  });
});

describe('createRendererSelfHeal', () => {
  function makeDeps(overrides?: Partial<RendererSelfHealDeps>): {
    deps: RendererSelfHealDeps;
    relaunch: ReturnType<typeof vi.fn>;
    clock: { value: number };
  } {
    const clock = { value: 0 };
    const relaunch = vi.fn(async () => true);
    const deps: RendererSelfHealDeps = {
      getBytes: () => FAT,
      getActivity: () => ({ runActive: false, protectedWork: false }),
      isDocumentHidden: () => true,
      isWindowFocused: () => false,
      requestRelaunch: relaunch,
      now: () => clock.value,
      ...overrides,
    };
    return { deps, relaunch, clock };
  }

  it('starts the hidden hold on the first hidden tick and fires once it elapses', () => {
    const { deps, relaunch, clock } = makeDeps();
    const selfHeal = createRendererSelfHeal(deps);

    expect(selfHeal.tick()).toBe(false);
    clock.value = SELF_HEAL_HIDDEN_HOLD_MS - 1;
    expect(selfHeal.tick()).toBe(false);

    clock.value = SELF_HEAL_HIDDEN_HOLD_MS;
    expect(selfHeal.tick()).toBe(true);
    expect(relaunch).toHaveBeenCalledOnce();
    expect(selfHeal.tick()).toBe(false);
    selfHeal.dispose();
  });

  it('resets the hidden hold when the window becomes visible again', () => {
    let hidden = true;
    const { deps, relaunch, clock } = makeDeps({ isDocumentHidden: () => hidden });
    const selfHeal = createRendererSelfHeal(deps);

    selfHeal.tick();
    clock.value = SELF_HEAL_HIDDEN_HOLD_MS - 1;
    hidden = false;
    expect(selfHeal.tick()).toBe(false);
    hidden = true;
    clock.value = clock.value + SELF_HEAL_HIDDEN_HOLD_MS - 1;
    expect(selfHeal.tick()).toBe(false);
    expect(relaunch).not.toHaveBeenCalled();
    selfHeal.dispose();
  });

  it('holds fire while busy and fires on the next idle tick', () => {
    let busy = true;
    const { deps, relaunch, clock } = makeDeps({
      getActivity: () => ({ runActive: busy, protectedWork: false }),
    });
    const selfHeal = createRendererSelfHeal(deps);

    selfHeal.tick();
    clock.value = SELF_HEAL_HIDDEN_HOLD_MS;
    expect(selfHeal.tick()).toBe(false);
    busy = false;
    expect(selfHeal.tick()).toBe(true);
    expect(relaunch).toHaveBeenCalledOnce();
    selfHeal.dispose();
  });

  it('flushes presentation state before asking native code to terminate the renderer', () => {
    const order: string[] = [];
    const { deps, clock } = makeDeps({
      beforeRelaunch: () => {
        order.push('flush');
      },
      requestRelaunch: async () => {
        order.push('relaunch');
        return true;
      },
    });
    const selfHeal = createRendererSelfHeal(deps);
    selfHeal.tick();
    expect(order).toEqual([]);
    clock.value = SELF_HEAL_HIDDEN_HOLD_MS;
    expect(selfHeal.tick()).toBe(true);
    expect(order).toEqual(['flush', 'relaunch']);
    selfHeal.dispose();
  });

  it('does not relaunch a focused visible window even when fat', () => {
    const { deps, relaunch, clock } = makeDeps({
      isDocumentHidden: () => false,
      isWindowFocused: () => true,
    });
    const selfHeal = createRendererSelfHeal(deps);
    clock.value = SELF_HEAL_UNFOCUSED_HOLD_MS;
    expect(selfHeal.tick()).toBe(false);
    expect(relaunch).not.toHaveBeenCalled();
    selfHeal.dispose();
  });

  it('lets protected owners veto without consuming the relaunch cooldown', () => {
    const beforeRelaunch = vi.fn(() => false);
    const { deps, relaunch, clock } = makeDeps({ beforeRelaunch });
    const selfHeal = createRendererSelfHeal(deps);
    selfHeal.tick();
    clock.value = SELF_HEAL_HIDDEN_HOLD_MS;
    expect(selfHeal.tick()).toBe(false);
    expect(relaunch).not.toHaveBeenCalled();
    beforeRelaunch.mockReturnValue(true);
    expect(selfHeal.tick()).toBe(true);
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it('does not issue another native request while one is outstanding', async () => {
    let complete: ((value: boolean) => void) | undefined;
    const requestRelaunch = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          complete = resolve;
        }),
    );
    const { deps, clock } = makeDeps({ getBytes: () => SELF_HEAL_MAX_BYTES, requestRelaunch });
    const selfHeal = createRendererSelfHeal(deps);
    expect(selfHeal.tick()).toBe(true);
    clock.value = SELF_HEAL_COOLDOWN_MS;
    expect(selfHeal.tick()).toBe(false);
    expect(requestRelaunch).toHaveBeenCalledOnce();
    complete?.(true);
    await vi.waitFor(() => expect(selfHeal.tick()).toBe(true));
  });
});
