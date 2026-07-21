import { describe, expect, it } from 'vitest';
import {
  INITIAL_ARTIFACT_IFRAME_HEIGHT,
  MAX_ARTIFACT_EXPANDED_HEIGHT,
  MIN_ARTIFACT_IFRAME_HEIGHT,
} from './constants.js';
import {
  ARTIFACT_INTERACTION_SHRINK_CONFIRM_MS,
  clampArtifactHeight,
  normalizeArtifactHeight,
  resolveImmediateArtifactHeight,
  resolveInteractiveArtifactShrink,
} from './height-policy.js';

describe('normalizeArtifactHeight', () => {
  it('uses the initial height fallback for missing measurements', () => {
    expect(
      normalizeArtifactHeight(0, MIN_ARTIFACT_IFRAME_HEIGHT, INITIAL_ARTIFACT_IFRAME_HEIGHT),
    ).toBe(INITIAL_ARTIFACT_IFRAME_HEIGHT);
  });

  it('raises tiny positive measurements to the minimum height', () => {
    expect(
      normalizeArtifactHeight(42, MIN_ARTIFACT_IFRAME_HEIGHT, INITIAL_ARTIFACT_IFRAME_HEIGHT),
    ).toBe(MIN_ARTIFACT_IFRAME_HEIGHT);
  });
});

describe('clampArtifactHeight', () => {
  it('caps at max height', () => {
    expect(
      clampArtifactHeight(2000, MIN_ARTIFACT_IFRAME_HEIGHT, 900, INITIAL_ARTIFACT_IFRAME_HEIGHT),
    ).toBe(900);
  });

  it('allows expanded max beyond default 900', () => {
    expect(
      clampArtifactHeight(
        3000,
        MIN_ARTIFACT_IFRAME_HEIGHT,
        MAX_ARTIFACT_EXPANDED_HEIGHT,
        INITIAL_ARTIFACT_IFRAME_HEIGHT,
      ),
    ).toBe(MAX_ARTIFACT_EXPANDED_HEIGHT);
  });
});

describe('resolveImmediateArtifactHeight', () => {
  it('protected phase respects the temporary floor', () => {
    expect(
      resolveImmediateArtifactHeight({
        height: 320,
        currentHeight: 760,
        floor: 700,
        phase: 'protected',
        mode: 'normal',
        minHeight: MIN_ARTIFACT_IFRAME_HEIGHT,
        initialHeight: INITIAL_ARTIFACT_IFRAME_HEIGHT,
      }),
    ).toBe(700);
  });

  it('interactive normal mode ignores passive shrink', () => {
    expect(
      resolveImmediateArtifactHeight({
        height: 360,
        currentHeight: 820,
        floor: 820,
        phase: 'interactive',
        mode: 'normal',
        minHeight: MIN_ARTIFACT_IFRAME_HEIGHT,
        initialHeight: INITIAL_ARTIFACT_IFRAME_HEIGHT,
      }),
    ).toBe(820);
  });

  it('interactive interaction mode allows shrink', () => {
    expect(
      resolveImmediateArtifactHeight({
        height: 360,
        currentHeight: 820,
        floor: 820,
        phase: 'interactive',
        mode: 'interaction',
        minHeight: MIN_ARTIFACT_IFRAME_HEIGHT,
        initialHeight: INITIAL_ARTIFACT_IFRAME_HEIGHT,
      }),
    ).toBe(360);
  });
});

describe('resolveInteractiveArtifactShrink', () => {
  it('starts only the first quick shrink confirmation timer', () => {
    expect(ARTIFACT_INTERACTION_SHRINK_CONFIRM_MS).toBeLessThanOrEqual(80);
    expect(
      resolveInteractiveArtifactShrink({
        phase: 'interactive',
        mode: 'interaction',
        nextHeight: 420,
        currentHeight: 920,
        timerActive: false,
      }),
    ).toEqual({ defer: true, startTimer: true, pendingHeight: 420 });
  });

  it('does not defer expansions', () => {
    expect(
      resolveInteractiveArtifactShrink({
        phase: 'interactive',
        mode: 'normal',
        nextHeight: 960,
        currentHeight: 920,
        timerActive: false,
      }),
    ).toEqual({ defer: false, startTimer: false, pendingHeight: null });
  });
});
