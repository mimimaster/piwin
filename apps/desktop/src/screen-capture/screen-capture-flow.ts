/**
 * Screen capture orchestration (spec 2026-10-25 §4): pre-checks, permission,
 * capture, read. UI state and the annotation editor live in the hook; this
 * stays free of React so every branch is unit-tested with a fake OS.
 */
import type { DesktopLocale } from '../i18n/desktop-locale.js';
import { SCREEN_CAPTURE_ERROR, type DesktopScreenCaptureOs } from './screen-capture-os.js';

export type ScreenCaptureFlowDeps = {
  os: DesktopScreenCaptureOs;
  /** Same gate as the file picker; it shows its own UI (trust dialog) when false. */
  canAttach: () => boolean;
  /** ADR 0082 reason when the active backend cannot take images. */
  imageRefusal: () => string | undefined;
};

export type ScreenCaptureFlowResult =
  | { kind: 'blocked' }
  | { kind: 'refused'; reason: string }
  | { kind: 'unsupported' }
  | { kind: 'needs-permission' }
  | { kind: 'busy' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; code: string }
  | {
      kind: 'captured';
      bytes: Uint8Array;
      width: number;
      height: number;
      systemRegionPicker: boolean;
    };

export async function runScreenCapture(
  deps: ScreenCaptureFlowDeps,
): Promise<ScreenCaptureFlowResult> {
  if (!deps.canAttach()) {
    return { kind: 'blocked' };
  }
  const refusal = deps.imageRefusal();
  if (refusal !== undefined) {
    return { kind: 'refused', reason: refusal };
  }
  const capabilities = await deps.os.capabilities();
  if (!capabilities.supported) {
    return { kind: 'unsupported' };
  }
  // SC-R10: checked every time, the user can revoke the grant in Settings.
  const authorization = await deps.os.authorizationStatus();
  if (authorization === 'unsupported') {
    return { kind: 'unsupported' };
  }
  if (authorization !== 'authorized') {
    return { kind: 'needs-permission' };
  }
  const outcome = await deps.os.take();
  if (outcome.status === 'cancelled') {
    return { kind: 'cancelled' };
  }
  if (outcome.status === 'failed') {
    if (outcome.code === SCREEN_CAPTURE_ERROR.busy) {
      return { kind: 'busy' };
    }
    if (outcome.code === SCREEN_CAPTURE_ERROR.denied) {
      return { kind: 'needs-permission' };
    }
    if (outcome.code === SCREEN_CAPTURE_ERROR.unsupported) {
      return { kind: 'unsupported' };
    }
    return { kind: 'failed', code: outcome.code };
  }
  const bytes = await deps.os.read(outcome.id);
  return {
    kind: 'captured',
    bytes,
    width: outcome.width,
    height: outcome.height,
    systemRegionPicker: capabilities.systemRegionPicker,
  };
}

/** `screenshot-20261025-145301.png`, local time. */
export function screenshotFileName(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `screenshot-${day}-${time}.png`;
}

export function screenCaptureFailureMessage(locale: DesktopLocale): string {
  return locale === 'zh-CN' ? '截屏失败，请重试。' : 'Screenshot failed. Try again.';
}

export function screenCaptureUnsupportedMessage(locale: DesktopLocale): string {
  return locale === 'zh-CN'
    ? '当前平台暂不支持内置截屏。'
    : 'Built-in screenshots are not available on this platform yet.';
}
