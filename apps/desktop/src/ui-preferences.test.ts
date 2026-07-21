import { describe, expect, it } from 'vitest';
import {
  densityToSliderValue,
  sliderValueToDensity,
} from './ui-preferences';

describe('ui-preferences density mapping', () => {
  it('maps slider ends', () => {
    expect(sliderValueToDensity(0)).toBe('compact');
    expect(sliderValueToDensity(1)).toBe('comfortable');
    expect(sliderValueToDensity(2)).toBe('detailed');
    expect(densityToSliderValue('compact')).toBe(0);
    expect(densityToSliderValue('detailed')).toBe(2);
  });
});
