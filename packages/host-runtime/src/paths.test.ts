import { afterEach, describe, expect, it } from 'vitest';
import {
  getPiAgentDir,
  getPiwinPiAgentDir,
  getPiwinConfigPath,
  getPiwinRoot,
  getPiwinSessionDir,
  getPiwinSessionMediaDir,
  resolveHostPiAgentDir,
  applyPiwinPlaywrightBrowsersPath,
  getPiwinPlaywrightDir,
} from './paths.js';

describe('paths', () => {
  it('uses override root', () => {
    expect(getPiwinRoot('/tmp/piwin-test')).toBe('/tmp/piwin-test');
  });

  it('uses override Pi agent dir', () => {
    expect(getPiAgentDir('/tmp/pi-agent')).toBe('/tmp/pi-agent');
  });

  it('hosts Pi auth under the product root', () => {
    expect(getPiwinPiAgentDir('/tmp/piwin-test')).toBe('/tmp/piwin-test/pi-agent');
    expect(resolveHostPiAgentDir({ piwinRoot: '/tmp/piwin-test' })).toBe('/tmp/piwin-test/pi-agent');
    expect(resolveHostPiAgentDir({ piwinRoot: '/tmp/piwin-test', piAgentDir: '/tmp/explicit' })).toBe(
      '/tmp/explicit',
    );
  });

  it('builds config path', () => {
    expect(getPiwinConfigPath('/tmp/piwin-test')).toBe('/tmp/piwin-test/config.json');
  });

  it.each(['', '.', '..', '../escape', 'nested/session', 'nested\\session', 'nul\0id'])(
    'rejects unsafe session path segment %j',
    (sessionId) => {
      expect(() => getPiwinSessionDir('/tmp/piwin-test', sessionId)).toThrow(/Invalid sessionId/);
      expect(() => getPiwinSessionMediaDir('/tmp/piwin-test', sessionId)).toThrow(
        /Invalid sessionId/,
      );
    },
  );
});

describe('playwright browsers path', () => {
  const originalBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const originalOverride = process.env.PIWIN_PLAYWRIGHT_BROWSERS_PATH;
  const originalBundled = process.env.PIWIN_DESKTOP_BUNDLED;

  afterEach(() => {
    if (originalBrowsersPath === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    else process.env.PLAYWRIGHT_BROWSERS_PATH = originalBrowsersPath;
    if (originalOverride === undefined) delete process.env.PIWIN_PLAYWRIGHT_BROWSERS_PATH;
    else process.env.PIWIN_PLAYWRIGHT_BROWSERS_PATH = originalOverride;
    if (originalBundled === undefined) delete process.env.PIWIN_DESKTOP_BUNDLED;
    else process.env.PIWIN_DESKTOP_BUNDLED = originalBundled;
  });

  it('places the cache under the product root', () => {
    expect(getPiwinPlaywrightDir('/tmp/piwin-test')).toBe('/tmp/piwin-test/playwright');
  });

  it('sets PLAYWRIGHT_BROWSERS_PATH to the Host cache', () => {
    delete process.env.PIWIN_PLAYWRIGHT_BROWSERS_PATH;
    delete process.env.PIWIN_DESKTOP_BUNDLED;
    expect(applyPiwinPlaywrightBrowsersPath('/tmp/piwin-test')).toBe('/tmp/piwin-test/playwright');
    expect(process.env.PLAYWRIGHT_BROWSERS_PATH).toBe('/tmp/piwin-test/playwright');
  });

  it('honors PIWIN_PLAYWRIGHT_BROWSERS_PATH outside a bundled sidecar', () => {
    delete process.env.PIWIN_DESKTOP_BUNDLED;
    process.env.PIWIN_PLAYWRIGHT_BROWSERS_PATH = '/Volumes/cache/playwright';
    expect(applyPiwinPlaywrightBrowsersPath('/tmp/piwin-test')).toBe('/Volumes/cache/playwright');
  });

  it('ignores a developer override in a bundled sidecar', () => {
    process.env.PIWIN_DESKTOP_BUNDLED = '1';
    process.env.PIWIN_PLAYWRIGHT_BROWSERS_PATH = '/Volumes/cache/playwright';
    expect(applyPiwinPlaywrightBrowsersPath('/Users/me/.piwin')).toBe(
      '/Users/me/.piwin/playwright',
    );
  });
});
