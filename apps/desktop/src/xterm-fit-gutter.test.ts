import { describe, expect, it } from 'vitest';
import { fullBleedColumns } from './xterm-fit-gutter';

describe('fullBleedColumns', () => {
  it('gives back the columns FitAddon withheld for a scrollbar', () => {
    // 100 cols × 7px = 700, container is 14px wider: the scrollbar gutter.
    expect(fullBleedColumns({
      screenWidth: 700,
      columns: 100,
      containerWidth: 714,
      paddingX: 0,
    })).toBe(102);
  });

  it('leaves a grid that already fills the container', () => {
    expect(fullBleedColumns({
      screenWidth: 714,
      columns: 102,
      containerWidth: 714,
      paddingX: 0,
    })).toBeUndefined();
  });

  it('keeps horizontal padding out of the grid', () => {
    expect(fullBleedColumns({
      screenWidth: 700,
      columns: 100,
      containerWidth: 720,
      paddingX: 8,
    })).toBe(101);
  });

  it('ignores a grid that has not been measured yet', () => {
    expect(fullBleedColumns({
      screenWidth: 0,
      columns: 80,
      containerWidth: 800,
      paddingX: 0,
    })).toBeUndefined();
  });
});
