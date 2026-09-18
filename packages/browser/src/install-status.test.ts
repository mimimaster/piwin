import { afterEach, describe, expect, it, vi } from 'vitest';

const executablePathMock = vi.hoisted(() => vi.fn());

vi.mock('playwright-core', () => ({
  chromium: { executablePath: executablePathMock },
}));

import { classifyBrowserLaunchError, getBrowserInstallStatus } from './install-status.js';

describe('getBrowserInstallStatus', () => {
  const originalBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;

  afterEach(() => {
    if (originalBrowsersPath === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    else process.env.PLAYWRIGHT_BROWSERS_PATH = originalBrowsersPath;
  });

  it('reports available with a path when headed Chromium exists on disk', async () => {
    executablePathMock.mockReturnValue(process.execPath);
    const status = await getBrowserInstallStatus({ variant: 'chromium' });
    expect(status.available).toBe(true);
    expect(status.path).toBe(process.execPath);
    expect(status.hint).toBeUndefined();
  });

  it('reports missing with an actionable hint when headed Chromium is absent', async () => {
    executablePathMock.mockReturnValue('/nonexistent/chromium-binary-nowhere');
    const status = await getBrowserInstallStatus({ variant: 'chromium' });
    expect(status.available).toBe(false);
    expect(status.hint).toContain('first time the browser is used');
    expect(status.reason).toBe('binary-missing');
  });

  it('falls back to a hint when headed Chromium path cannot be resolved', async () => {
    executablePathMock.mockImplementation(() => {
      throw new Error('playwright browsers not found');
    });
    const status = await getBrowserInstallStatus({ variant: 'chromium' });
    expect(status.available).toBe(false);
    expect(status.hint).toContain('first time the browser is used');
    expect(status.reason).toBe('binary-missing');
  });

  it('looks for headless-shell under PLAYWRIGHT_BROWSERS_PATH by default', async () => {
    process.env.PLAYWRIGHT_BROWSERS_PATH = '/tmp/piwin-playwright-status-missing';
    const status = await getBrowserInstallStatus();
    expect(status.available).toBe(false);
    expect(status.path).toContain('chromium_headless_shell-');
    expect(status.path).toContain('chrome-headless-shell');
    expect(status.reason).toBe('binary-missing');
  });
});

describe('classifyBrowserLaunchError', () => {
  it('detects a profile already in use', () => {
    expect(classifyBrowserLaunchError(new Error('Profile is already in use'))).toBe(
      'profile-in-use',
    );
  });

  it('detects a missing executable', () => {
    expect(classifyBrowserLaunchError(new Error("browserType.launch: Executable doesn't exist"))).toBe(
      'binary-missing',
    );
  });

  it('falls back to startup-failed', () => {
    expect(classifyBrowserLaunchError(new Error('Target closed'))).toBe('startup-failed');
  });
});
