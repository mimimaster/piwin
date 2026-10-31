import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_STEALTH_CHROMIUM_ARGS,
  DEFAULT_STEALTH_IGNORE_DEFAULT_ARGS,
  defaultDesktopUserAgent,
  hasSystemChrome,
  launchChromiumContext,
} from './browser-launch.js';

describe('browser-launch stealth configuration', () => {
  it('generates a clean desktop user agent without HeadlessChrome', () => {
    const macUa = defaultDesktopUserAgent('darwin');
    expect(macUa).toContain('Macintosh');
    expect(macUa).toContain('Chrome/');
    expect(macUa).not.toContain('HeadlessChrome');

    const winUa = defaultDesktopUserAgent('win32');
    expect(winUa).toContain('Windows NT');
    expect(winUa).toContain('Chrome/');
    expect(winUa).not.toContain('HeadlessChrome');

    const linuxUa = defaultDesktopUserAgent('linux');
    expect(linuxUa).toContain('Linux');
    expect(linuxUa).toContain('Chrome/');
    expect(linuxUa).not.toContain('HeadlessChrome');
  });

  it('defines default anti-bot flags', () => {
    expect(DEFAULT_STEALTH_CHROMIUM_ARGS).toContain('--disable-blink-features=AutomationControlled');
    expect(DEFAULT_STEALTH_IGNORE_DEFAULT_ARGS).toContain('--enable-automation');
  });

  it('checks for system chrome without throwing', () => {
    expect(typeof hasSystemChrome()).toBe('boolean');
  });

  it('injects stealth flags and default user agent into launchPersistentContext', async () => {
    const launchMock = vi.fn().mockResolvedValue({
      close: vi.fn(),
    });

    await launchChromiumContext({
      profileDir: '/tmp/test-profile',
      headless: true,
      viewport: { width: 1280, height: 800 },
      launchPersistentContext: launchMock,
    });

    expect(launchMock).toHaveBeenCalledTimes(1);
    const [calledProfile, calledOptions] = launchMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(calledProfile).toBe('/tmp/test-profile');
    expect(calledOptions.headless).toBe(true);
    expect(calledOptions.ignoreDefaultArgs).toEqual(['--enable-automation']);
    expect(calledOptions.args).toEqual(
      expect.arrayContaining(['--disable-blink-features=AutomationControlled']),
    );
    expect(typeof calledOptions.userAgent).toBe('string');
    expect(calledOptions.userAgent as string).not.toContain('HeadlessChrome');
  });

  it('preserves caller custom userAgent and args', async () => {
    const launchMock = vi.fn().mockResolvedValue({
      close: vi.fn(),
    });

    await launchChromiumContext({
      profileDir: '/tmp/test-profile',
      headless: true,
      viewport: { width: 1280, height: 800 },
      userAgent: 'CustomAgent/1.0',
      args: ['--custom-arg'],
      channel: 'chrome',
      ignoreDefaultArgs: ['--different-flag'],
      launchPersistentContext: launchMock,
    });

    expect(launchMock).toHaveBeenCalledTimes(1);
    const [, calledOptions] = launchMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(calledOptions.userAgent).toBe('CustomAgent/1.0');
    expect(calledOptions.channel).toBe('chrome');
    expect(calledOptions.ignoreDefaultArgs).toEqual(['--different-flag']);
    expect(calledOptions.args).toEqual(
      expect.arrayContaining(['--custom-arg', '--disable-blink-features=AutomationControlled']),
    );
  });
});
