import { describe, expect, it, vi } from 'vitest';
import {
  createRendererSelfHeal,
  SELF_HEAL_COOLDOWN_MS,
  SELF_HEAL_HIDDEN_HOLD_MS,
  SELF_HEAL_RECLAIM_BYTES,
  SELF_HEAL_UNFOCUSED_HOLD_MS,
  shouldRelaunchRenderer,
  type RendererSelfHealDeps,
} from './renderer-self-heal';

const FAT = SELF_HEAL_RECLAIM_BYTES;
const HIDDEN_READY = {
  bytes: FAT,
  busy: false,
  documentHidden: true,
  windowFocused: false,
  hiddenSinceMs: 0,
  unfocusedSinceMs: 0,
  lastAttemptAtMs: null,
  nowMs: SELF_HEAL_HIDDEN_HOLD_MS,
};

describe('shouldRelaunchRenderer', () => {
  it('fires after the window has been hidden long enough once footprint is fat', () => {
    expect(shouldRelaunchRenderer(HIDDEN_READY)).toBe(true);
    expect(
      shouldRelaunchRenderer({ ...HIDDEN_READY, nowMs: SELF_HEAL_HIDDEN_HOLD_MS - 1 }),
    ).toBe(false);
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

  it('never interrupts a streaming run', () => {
    expect(shouldRelaunchRenderer({ ...HIDDEN_READY, busy: true })).toBe(false);
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
      isBusy: () => false,
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
    const { deps, relaunch, clock } = makeDeps({ isBusy: () => busy });
    const selfHeal = createRendererSelfHeal(deps);

    selfHeal.tick();
    clock.value = SELF_HEAL_HIDDEN_HOLD_MS;
    expect(selfHeal.tick()).toBe(false);
    busy = false;
    expect(selfHeal.tick()).toBe(true);
    expect(relaunch).toHaveBeenCalledOnce();
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
});
