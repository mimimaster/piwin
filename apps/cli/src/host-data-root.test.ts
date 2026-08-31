import { afterEach, describe, expect, it } from 'vitest';
import { resolveHostDataRoot } from './host-data-root.js';

const originalPiwinRoot = process.env.PIWIN_ROOT;
const originalBundledFlag = process.env.PIWIN_DESKTOP_BUNDLED;

afterEach(() => {
  if (originalPiwinRoot === undefined) {
    delete process.env.PIWIN_ROOT;
  } else {
    process.env.PIWIN_ROOT = originalPiwinRoot;
  }
  if (originalBundledFlag === undefined) {
    delete process.env.PIWIN_DESKTOP_BUNDLED;
  } else {
    process.env.PIWIN_DESKTOP_BUNDLED = originalBundledFlag;
  }
});

describe('resolveHostDataRoot', () => {
  it('forces the default user root for the bundled Desktop', () => {
    process.env.PIWIN_ROOT = '/tmp/piwin-test';
    process.env.PIWIN_DESKTOP_BUNDLED = '1';

    expect(resolveHostDataRoot()).toBe(`${process.env.HOME}/.piwin`);
  });

  it('keeps explicit roots for standalone and test Hosts', () => {
    process.env.PIWIN_ROOT = '/tmp/piwin-test';
    delete process.env.PIWIN_DESKTOP_BUNDLED;

    expect(resolveHostDataRoot()).toBe('/tmp/piwin-test');
  });
});
