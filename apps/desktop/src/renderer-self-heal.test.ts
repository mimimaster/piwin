import { afterEach, describe, expect, it, vi } from 'vitest';
import { globalMemoryGovernor } from './memory-governor';
import {
  createRendererSelfHeal,
  SELF_HEAL_COOLDOWN_MS,
  SELF_HEAL_CRITICAL_HOLD_MS,
  shouldRelaunchRenderer,
  type RendererSelfHealDeps,
} from './renderer-self-heal';

const BASE = {
  level: 'critical' as const,
  criticalSinceMs: 0,
  busy: false,
  documentHidden: true,
  lastAttemptAtMs: null,
  nowMs: SELF_HEAL_CRITICAL_HOLD_MS,
};

describe('shouldRelaunchRenderer', () => {
  it('fires only after critical has held for the full window while hidden and idle', () => {
    expect(shouldRelaunchRenderer(BASE)).toBe(true);
    expect(shouldRelaunchRenderer({ ...BASE, nowMs: SELF_HEAL_CRITICAL_HOLD_MS - 1 })).toBe(false);
  });

  it('never fires outside critical or without a critical start time', () => {
    expect(shouldRelaunchRenderer({ ...BASE, level: 'moderate' })).toBe(false);
    expect(shouldRelaunchRenderer({ ...BASE, level: 'normal' })).toBe(false);
    expect(shouldRelaunchRenderer({ ...BASE, criticalSinceMs: null })).toBe(false);
  });

  it('never interrupts a streaming run or a visible window', () => {
    expect(shouldRelaunchRenderer({ ...BASE, busy: true })).toBe(false);
    expect(shouldRelaunchRenderer({ ...BASE, documentHidden: false })).toBe(false);
  });

  it('respects the attempt cooldown', () => {
    const nowMs = SELF_HEAL_CRITICAL_HOLD_MS + SELF_HEAL_COOLDOWN_MS;
    expect(
      shouldRelaunchRenderer({ ...BASE, nowMs, lastAttemptAtMs: nowMs - SELF_HEAL_COOLDOWN_MS + 1 }),
    ).toBe(false);
    expect(
      shouldRelaunchRenderer({ ...BASE, nowMs, lastAttemptAtMs: nowMs - SELF_HEAL_COOLDOWN_MS }),
    ).toBe(true);
  });
});

describe('createRendererSelfHeal', () => {
  afterEach(() => {
    globalMemoryGovernor.reset();
  });

  function makeDeps(overrides?: Partial<RendererSelfHealDeps>): {
    deps: RendererSelfHealDeps;
    relaunch: ReturnType<typeof vi.fn>;
    clock: { value: number };
  } {
    const clock = { value: 0 };
    const relaunch = vi.fn(async () => true);
    const deps: RendererSelfHealDeps = {
      getLevel: globalMemoryGovernor.getLevel,
      subscribeLevel: globalMemoryGovernor.subscribe,
      isBusy: () => false,
      isDocumentHidden: () => true,
      requestRelaunch: relaunch,
      now: () => clock.value,
      ...overrides,
    };
    return { deps, relaunch, clock };
  }

  it('tracks the critical hold via governor subscription and fires once', () => {
    const { deps, relaunch, clock } = makeDeps();
    const selfHeal = createRendererSelfHeal(deps);

    globalMemoryGovernor.setLevel('critical');
    clock.value = SELF_HEAL_CRITICAL_HOLD_MS - 1;
    expect(selfHeal.tick()).toBe(false);

    clock.value = SELF_HEAL_CRITICAL_HOLD_MS;
    expect(selfHeal.tick()).toBe(true);
    expect(relaunch).toHaveBeenCalledOnce();

    // Immediately after an attempt the cooldown blocks a repeat.
    expect(selfHeal.tick()).toBe(false);
    selfHeal.dispose();
  });

  it('resets the hold when pressure recovers before the window elapses', () => {
    const { deps, relaunch, clock } = makeDeps();
    const selfHeal = createRendererSelfHeal(deps);

    globalMemoryGovernor.setLevel('critical');
    clock.value = SELF_HEAL_CRITICAL_HOLD_MS - 1;
    globalMemoryGovernor.setLevel('moderate');
    globalMemoryGovernor.setLevel('critical');
    clock.value = clock.value + SELF_HEAL_CRITICAL_HOLD_MS - 1;
    expect(selfHeal.tick()).toBe(false);
    expect(relaunch).not.toHaveBeenCalled();
    selfHeal.dispose();
  });

  it('holds fire while busy and fires on the next idle tick', () => {
    let busy = true;
    const { deps, relaunch, clock } = makeDeps({ isBusy: () => busy });
    const selfHeal = createRendererSelfHeal(deps);

    globalMemoryGovernor.setLevel('critical');
    clock.value = SELF_HEAL_CRITICAL_HOLD_MS;
    expect(selfHeal.tick()).toBe(false);
    busy = false;
    expect(selfHeal.tick()).toBe(true);
    expect(relaunch).toHaveBeenCalledOnce();
    selfHeal.dispose();
  });
});
