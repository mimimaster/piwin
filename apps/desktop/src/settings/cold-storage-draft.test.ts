import { describe, expect, it } from 'vitest';
import {
  coldStorageDraftDirty,
  coldStorageToDraft,
  draftToColdStorage,
} from './cold-storage-draft';

describe('cold storage draft', () => {
  it('round-trips enabled Host path and optional budget', () => {
    const draft = coldStorageToDraft({
      enabled: true,
      packOutputDir: '/Volumes/Drive/piwin-packs',
      minArchivedAgeDays: 14,
      localBudgetBytes: 2048,
    });
    expect(draftToColdStorage(draft)).toEqual({
      enabled: true,
      packOutputDir: '/Volumes/Drive/piwin-packs',
      minArchivedAgeDays: 14,
      localBudgetBytes: 2048,
    });
  });

  it('omits empty output dir and invalid budget', () => {
    expect(
      draftToColdStorage({
        enabled: false,
        packOutputDir: '  ',
        minArchivedAgeDays: '0',
        localBudgetBytes: 'nope',
      }),
    ).toEqual({
      enabled: false,
      minArchivedAgeDays: 30,
    });
  });

  it('detects unsaved draft changes', () => {
    const saved = {
      enabled: true,
      packOutputDir: '/tmp/packs',
      minArchivedAgeDays: 30,
    };
    expect(coldStorageDraftDirty(coldStorageToDraft(saved), saved)).toBe(false);
    expect(
      coldStorageDraftDirty({ ...coldStorageToDraft(saved), packOutputDir: '/tmp/other' }, saved),
    ).toBe(true);
  });
});
