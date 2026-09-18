import { describe, expect, it, vi } from 'vitest';
import { AbortOperationError, BrowserUnavailableError } from './browser-errors.js';
import {
  ensurePlaywrightChromium,
  resolvePlaywrightCoreCliPath,
} from './ensure-playwright-chromium.js';

describe('resolvePlaywrightCoreCliPath', () => {
  it('resolves playwright-core/cli.js next to the installed package', () => {
    expect(resolvePlaywrightCoreCliPath().endsWith('playwright-core/cli.js')).toBe(true);
  });
});

describe('ensurePlaywrightChromium', () => {
  it('skips install when the executable is already present', async () => {
    const install = vi.fn(async () => undefined);
    const status = await ensurePlaywrightChromium({
      browsersPath: '/tmp/piwin-playwright',
      getStatus: () => ({ available: true, path: '/tmp/chrome' }),
      install,
    });
    expect(status.available).toBe(true);
    expect(install).not.toHaveBeenCalled();
  });

  it('downloads then rechecks when the executable is missing', async () => {
    const install = vi.fn(async () => undefined);
    let available = false;
    const status = await ensurePlaywrightChromium({
      browsersPath: '/tmp/piwin-playwright',
      getStatus: () =>
        available
          ? { available: true, path: '/tmp/chrome' }
          : { available: false, reason: 'binary-missing' },
      install: async (input) => {
        expect(input.browsersPath).toBe('/tmp/piwin-playwright');
        expect(input.variant).toBe('headless-shell');
        available = true;
        await install();
      },
    });
    expect(install).toHaveBeenCalledTimes(1);
    expect(status.path).toBe('/tmp/chrome');
  });

  it('throws browser-unavailable when install leaves the binary missing', async () => {
    await expect(
      ensurePlaywrightChromium({
        browsersPath: '/tmp/piwin-playwright',
        getStatus: () => ({
          available: false,
          reason: 'binary-missing',
          hint: 'open the browser panel',
        }),
        install: async () => undefined,
      }),
    ).rejects.toMatchObject({
      name: 'BrowserUnavailableError',
      reason: 'binary-missing',
    });
  });

  it('maps installer failures onto BrowserUnavailableError', async () => {
    await expect(
      ensurePlaywrightChromium({
        browsersPath: '/tmp/piwin-playwright',
        getStatus: () => ({ available: false, reason: 'binary-missing' }),
        install: async () => {
          throw new Error('network down');
        },
      }),
    ).rejects.toBeInstanceOf(BrowserUnavailableError);
  });

  it('does not wrap abort as a missing-binary failure', async () => {
    await expect(
      ensurePlaywrightChromium({
        browsersPath: '/tmp/piwin-playwright',
        getStatus: () => ({ available: false, reason: 'binary-missing' }),
        install: async () => {
          throw new AbortOperationError('operation aborted');
        },
      }),
    ).rejects.toBeInstanceOf(AbortOperationError);
  });
});
