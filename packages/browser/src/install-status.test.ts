import { describe, expect, it, vi } from 'vitest';

const executablePathMock = vi.hoisted(() => vi.fn());

vi.mock('playwright-core', () => ({
  chromium: { executablePath: executablePathMock },
}));

import { classifyBrowserLaunchError, getBrowserInstallStatus } from './install-status.js';

describe('getBrowserInstallStatus', () => {
  it('reports available with a path when the executable exists on disk', () => {
    executablePathMock.mockReturnValue(process.execPath);
    const status = getBrowserInstallStatus();
    expect(status.available).toBe(true);
    expect(status.path).toBe(process.execPath);
    expect(status.hint).toBeUndefined();
  });

  it('reports missing with an actionable hint when the executable is absent', () => {
    executablePathMock.mockReturnValue('/nonexistent/chromium-binary-nowhere');
    const status = getBrowserInstallStatus();
    expect(status.available).toBe(false);
    expect(status.hint).toContain('pnpm --dir apps/desktop e2e:install');
    expect(status.reason).toBe('binary-missing');
  });

  it('falls back to a hint when the executable path cannot be resolved', () => {
    executablePathMock.mockImplementation(() => {
      throw new Error('playwright browsers not found');
    });
    const status = getBrowserInstallStatus();
    expect(status.available).toBe(false);
    expect(status.hint).toContain('pnpm --dir apps/desktop e2e:install');
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
