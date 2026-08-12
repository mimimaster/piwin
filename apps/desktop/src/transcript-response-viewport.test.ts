import { describe, expect, it } from 'vitest';
import {
  computeCurrentResponseMinHeight,
  CURRENT_RESPONSE_VIEWPORT_RATIO,
} from './transcript-response-viewport.js';

describe('computeCurrentResponseMinHeight', () => {
  it('reserves three quarters of the available transcript viewport', () => {
    expect(CURRENT_RESPONSE_VIEWPORT_RATIO).toBe(0.75);
    expect(computeCurrentResponseMinHeight(800)).toBe(600);
    expect(computeCurrentResponseMinHeight(533)).toBe(400);
  });

  it('rejects invalid viewport measurements', () => {
    expect(computeCurrentResponseMinHeight(0)).toBe(0);
    expect(computeCurrentResponseMinHeight(-100)).toBe(0);
    expect(computeCurrentResponseMinHeight(Number.NaN)).toBe(0);
  });
});
