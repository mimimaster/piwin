import { describe, expect, it } from 'vitest';
import {
  playwrightChromiumInstallCliArgs,
  resolvePlaywrightHeadlessShellExecutablePath,
} from './playwright-chromium-variant.js';

describe('playwrightChromiumInstallCliArgs', () => {
  it('installs only the headless shell by default', () => {
    expect(playwrightChromiumInstallCliArgs()).toEqual(['install', 'chromium', '--only-shell']);
    expect(playwrightChromiumInstallCliArgs('headless-shell')).toEqual([
      'install',
      'chromium',
      '--only-shell',
    ]);
  });

  it('skips the shell when headed Chromium is required', () => {
    expect(playwrightChromiumInstallCliArgs('chromium')).toEqual([
      'install',
      'chromium',
      '--no-shell',
    ]);
  });
});

describe('resolvePlaywrightHeadlessShellExecutablePath', () => {
  const browsersJson = {
    browsers: [{ name: 'chromium-headless-shell', revision: '1228' }],
  };

  it('uses the Playwright cache folder name and mac-arm64 tokens', () => {
    expect(
      resolvePlaywrightHeadlessShellExecutablePath('/tmp/piwin-playwright', {
        platform: 'darwin',
        arch: 'arm64',
        browsersJson,
      }),
    ).toBe(
      '/tmp/piwin-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell',
    );
  });

  it('uses the linux-x64 chrome-for-testing layout', () => {
    expect(
      resolvePlaywrightHeadlessShellExecutablePath('/cache', {
        platform: 'linux',
        arch: 'x64',
        browsersJson,
      }),
    ).toBe('/cache/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell');
  });
});

