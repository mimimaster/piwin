import { describe, expect, it } from 'vitest';
import {
  browserRuntimeBannerMessage,
  browserRuntimeStatusCopy,
  isBrowserInteractEnabled,
  resolveBrowserRuntimeStatus,
  shouldShowBrowserRuntimeBanner,
} from './browser-runtime-status';

describe('browserRuntimeStatusCopy', () => {
  it('returns zh and en strings for starting/recovering/degraded/failed/restart', () => {
    expect(browserRuntimeStatusCopy('zh-CN').failed).toBe('浏览器会话失败。');
    expect(browserRuntimeStatusCopy('zh-CN').restart).toBe('重启');
    expect(browserRuntimeStatusCopy('en').failed).toBe('Browser session failed.');
    expect(browserRuntimeStatusCopy('en').restart).toBe('Restart');
  });
});

describe('isBrowserInteractEnabled', () => {
  it('allows input when Host has not yet sent lifecycle (legacy emitters)', () => {
    expect(
      isBrowserInteractEnabled({ lifecycle: undefined, mirror: undefined, mirrorError: null }),
    ).toBe(true);
  });

  it('disables input unless lifecycle is ready', () => {
    expect(
      isBrowserInteractEnabled({ lifecycle: 'recovering', mirror: 'off', mirrorError: null }),
    ).toBe(false);
    expect(
      isBrowserInteractEnabled({ lifecycle: 'failed', mirror: 'off', mirrorError: null }),
    ).toBe(false);
    expect(
      isBrowserInteractEnabled({ lifecycle: 'starting', mirror: 'off', mirrorError: null }),
    ).toBe(false);
    expect(
      isBrowserInteractEnabled({ lifecycle: 'ready', mirror: 'streaming', mirrorError: null }),
    ).toBe(true);
  });

  it('disables input when the mirror is degraded or off with an error', () => {
    expect(
      isBrowserInteractEnabled({ lifecycle: 'ready', mirror: 'degraded', mirrorError: null }),
    ).toBe(false);
    expect(
      isBrowserInteractEnabled({
        lifecycle: 'ready',
        mirror: 'off',
        mirrorError: 'Could not start the browser mirror.',
      }),
    ).toBe(false);
  });
});

describe('shouldShowBrowserRuntimeBanner', () => {
  it('shows for starting/recovering/failed/degraded and start errors', () => {
    expect(
      shouldShowBrowserRuntimeBanner({
        lifecycle: 'starting',
        mirror: 'off',
        mirrorError: null,
      }),
    ).toBe(true);
    expect(
      shouldShowBrowserRuntimeBanner({
        lifecycle: 'recovering',
        mirror: 'off',
        mirrorError: null,
      }),
    ).toBe(true);
    expect(
      shouldShowBrowserRuntimeBanner({
        lifecycle: 'failed',
        mirror: 'off',
        mirrorError: null,
      }),
    ).toBe(true);
    expect(
      shouldShowBrowserRuntimeBanner({
        lifecycle: 'ready',
        mirror: 'degraded',
        mirrorError: null,
      }),
    ).toBe(true);
    expect(
      shouldShowBrowserRuntimeBanner({
        lifecycle: undefined,
        mirror: undefined,
        mirrorError: 'boom',
      }),
    ).toBe(true);
    expect(
      shouldShowBrowserRuntimeBanner({
        lifecycle: 'ready',
        mirror: 'streaming',
        mirrorError: null,
      }),
    ).toBe(false);
  });
});

describe('browserRuntimeBannerMessage', () => {
  const copy = browserRuntimeStatusCopy('en');

  it('prefers failed over degraded', () => {
    expect(
      browserRuntimeBannerMessage(copy, {
        lifecycle: 'failed',
        mirror: 'degraded',
        mirrorError: null,
      }),
    ).toBe(copy.failed);
  });

  it('uses recovering copy while the Host is rebuilding', () => {
    expect(
      browserRuntimeBannerMessage(copy, {
        lifecycle: 'recovering',
        mirror: 'off',
        mirrorError: null,
      }),
    ).toBe(copy.recovering);
  });
});

describe('resolveBrowserRuntimeStatus', () => {
  it('exposes restart copy and disables interact while recovering', () => {
    const view = resolveBrowserRuntimeStatus('zh-CN', {
      lifecycle: 'recovering',
      mirror: 'off',
      mirrorError: null,
    });
    expect(view.showBanner).toBe(true);
    expect(view.interactEnabled).toBe(false);
    expect(view.message).toBe('正在恢复浏览器会话…');
    expect(view.restartLabel).toBe('重启');
  });
});
