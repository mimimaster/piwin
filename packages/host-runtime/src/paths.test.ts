import { describe, expect, it } from 'vitest';
import { getPiwinConfigPath, getPiwinRoot } from './paths.js';

describe('paths', () => {
  it('uses override root', () => {
    expect(getPiwinRoot('/tmp/piwin-test')).toBe('/tmp/piwin-test');
  });

  it('builds config path', () => {
    expect(getPiwinConfigPath('/tmp/piwin-test')).toBe('/tmp/piwin-test/config.json');
  });
});
