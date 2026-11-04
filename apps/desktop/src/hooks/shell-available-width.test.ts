import { expect, it } from 'vitest';
import { readShellAvailableWidth } from './shell-available-width.js';

it('subtracts asymmetric safe areas and clamps invalid or excessive insets', () => {
  const makeView = (left: string, right: string): Window => ({
    innerWidth: 1024,
    document: { documentElement: {} },
    getComputedStyle: () => ({ paddingLeft: left, paddingRight: right }),
  }) as unknown as Window;
  expect(readShellAvailableWidth(makeView('40px', '20px'))).toBe(964);
  expect(readShellAvailableWidth(makeView('invalid', '-10px'))).toBe(1024);
  expect(readShellAvailableWidth(makeView('800px', '800px'))).toBe(0);
});
