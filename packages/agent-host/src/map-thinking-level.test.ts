import { describe, expect, it } from 'vitest';
import {
  buildThinkingLevelMap,
  mapThinkingLevelToApi,
  mapThinkingLevelToPi,
  thinkingLevelsFromPiMap,
} from './map-thinking-level.js';

describe('mapThinkingLevelToApi', () => {
  it('passes through protocol API levels unchanged', () => {
    expect(mapThinkingLevelToApi('medium', 'openai-compatible')).toBe('medium');
    expect(mapThinkingLevelToApi('xhigh', 'openai-compatible')).toBe('xhigh');
    expect(mapThinkingLevelToApi('max', 'anthropic-compatible')).toBe('max');
  });

  it('maps product ultra to protocol API maxima', () => {
    expect(mapThinkingLevelToApi('ultra', 'openai-compatible')).toBe('xhigh');
    expect(mapThinkingLevelToApi('ultra', 'anthropic-compatible')).toBe('max');
    expect(mapThinkingLevelToApi('ultra', 'google-gemini')).toBe('xhigh');
  });
});

describe('mapThinkingLevelToPi', () => {
  it('maps product ultra to Pi canonical maximum levels', () => {
    expect(mapThinkingLevelToPi('ultra', 'openai-compatible')).toBe('xhigh');
    expect(mapThinkingLevelToPi('ultra', 'anthropic-compatible')).toBe('max');
    expect(mapThinkingLevelToPi('ultra', 'google-gemini')).toBe('xhigh');
  });
});

describe('buildThinkingLevelMap', () => {
  it('preserves configured max and xhigh while marking omitted levels unsupported', () => {
    expect(
      buildThinkingLevelMap(['low', 'medium', 'high', 'xhigh', 'max'], 'openai-compatible'),
    ).toEqual({
      off: null,
      minimal: null,
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max',
    });
  });

  it('maps product ultra to the protocol-specific Pi maximum', () => {
    expect(buildThinkingLevelMap(['high', 'ultra'], 'openai-compatible')).toMatchObject({
      high: 'high',
      xhigh: 'xhigh',
      max: null,
    });
    expect(buildThinkingLevelMap(['high', 'ultra'], 'anthropic-compatible')).toMatchObject({
      high: 'high',
      xhigh: null,
      max: 'max',
    });
  });

  it('does not create a map when model levels are not explicitly configured', () => {
    expect(buildThinkingLevelMap(undefined, 'openai-compatible')).toBeUndefined();
    expect(buildThinkingLevelMap([], 'openai-compatible')).toBeUndefined();
  });
});

describe('thinkingLevelsFromPiMap', () => {
  it('drops null entries and keeps Grok-style supported levels only', () => {
    expect(
      thinkingLevelsFromPiMap({
        off: null,
        minimal: null,
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: null,
        max: null,
      }),
    ).toEqual(['low', 'medium', 'high']);
  });

  it('keeps default mid-range levels for a sparse Codex-style map', () => {
    expect(
      thinkingLevelsFromPiMap({
        xhigh: 'xhigh',
        minimal: 'low',
      }),
    ).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);
  });

  it('treats xhigh and max as opt-in even when other keys are present', () => {
    expect(
      thinkingLevelsFromPiMap({
        off: 'off',
        low: 'low',
        medium: 'medium',
        high: 'high',
      }),
    ).toEqual(['off', 'minimal', 'low', 'medium', 'high']);
  });

  it('returns undefined when the map is missing or empty of supported levels', () => {
    expect(thinkingLevelsFromPiMap(undefined)).toBeUndefined();
    expect(
      thinkingLevelsFromPiMap({
        off: null,
        minimal: null,
        low: null,
        medium: null,
        high: null,
        xhigh: null,
        max: null,
      }),
    ).toBeUndefined();
  });
});
