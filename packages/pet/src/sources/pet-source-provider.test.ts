import { describe, expect, it } from 'vitest';
import { PET_SOURCE_PRIORITY } from './pet-source-provider.js';

describe('PET_SOURCE_PRIORITY', () => {
  it('orders bundled first, registry last', () => {
    expect(PET_SOURCE_PRIORITY).toEqual([
      'bundled',
      'local',
      'codex-live',
      'registry',
    ]);
  });
});
