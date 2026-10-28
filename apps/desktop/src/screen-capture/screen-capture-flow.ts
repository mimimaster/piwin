/**
 * Screen capture orchestration (spec 2026-10-25 §4, QQ-style revision §12.6):
 * permission, capture, and where the result goes. UI state and the editor
 * live in the hook; this stays free of React so every branch is unit-tested
 * with a fake OS.
 *
 * Overlay mode: the clipboard always gets the image. It also goes to the
 * composer when piwin was in front at the start, so a capture taken from
 * another app is never blocked by piwin's composer state.
 * System-picker mode (Linux): the composer is the only destination, so its
 * checks run before the OS picker opens.
 */
import type { DesktopLocale } from '../i18n/desktop-locale.js';
import { SCREEN_CAPTURE_ERROR, type DesktopScreenCaptureOs } from './screen-capture-os.js';

export type ScreenCaptureFlowDeps = {
  os: DesktopScreenCaptureOs;
  /** Same gate as the file picker; it shows its own UI (trust dialog) when false. */
  canAttach: () => boolean;
  /** ADR 0082 reason when the active backend cannot take images. */
  imageRefusal: () => string | undefined;
  /** piwin's window had focus when the capture was asked for. */
  piwinInFront: () => boolean;
};

export type ScreenCaptureFlowResult =
  | { kind: 'blocked'; copied: boolean }
  | { kind: 'refused'; reason: string; copied: boolean }
  | { kind: 'unsupported' }
  | { kind: 'needs-permission' }
  | { kind: 'busy' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; code: string }
  /** Finished on the overlay, clipboard only. */
  | { kind: 'copied' }
  /** Finished on the overlay, but the clipboard write failed. */
  | { kind: 'copy-failed' }
  /** Finished and annotated: attach as is. */
  | { kind: 'attach'; bytes: Uint8Array; copied: boolean }
  /** OS-picked region: open the editor first. */
  | { kind: 'edit'; bytes: Uint8Array; width: number; height: number };

function composerRefusal(
  deps: ScreenCaptureFlowDeps,
  copied: boolean,
): ScreenCaptureFlowResult | null {
  if (!deps.canAttach()) {
    return { kind: 'blocked', copied };
  }
  const reason = deps.imageRefusal();
  return reason === undefined ? null : { kind: 'refused', reason, copied };
}

export async function runScreenCapture(
  deps: ScreenCaptureFlowDeps,
): Promise<ScreenCaptureFlowResult> {
  const capabilities = await deps.os.capabilities();
  if (!capabilities.supported) {
    return { kind: 'unsupported' };
  }
  const overlay = capabilities.mode === 'overlay';
  if (!overlay) {
    const refusal = composerRefusal(deps, false);
    if (refusal !== null) return refusal;
  }
  // SC-R10: checked every time, the user can revoke the grant in Settings.
  const authorization = await deps.os.authorizationStatus();
  if (authorization === 'unsupported') {
    return { kind: 'unsupported' };
  }
  if (authorization !== 'authorized') {
    return { kind: 'needs-permission' };
  }
  const deliverToComposer = !overlay || deps.piwinInFront();
  const outcome = await deps.os.take({ deliverToComposer });
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
  if (outcome.id === null) {
    return outcome.copied ? { kind: 'copied' } : { kind: 'copy-failed' };
  }
  if (outcome.annotated) {
    const refusal = composerRefusal(deps, outcome.copied);
    if (refusal !== null) return refusal;
  }
  const bytes = await deps.os.read(outcome.id);
  return outcome.annotated
    ? { kind: 'attach', bytes, copied: outcome.copied }
    : { kind: 'edit', bytes, width: outcome.width, height: outcome.height };
}

/**
 * Outcomes that leave something for the user to read or answer in piwin.
 * After a global-shortcut trigger piwin may be behind another app; finished
 * captures and cancels need nothing (native restore already handled focus).
 */
export function screenCaptureNeedsAppInFront(result: ScreenCaptureFlowResult): boolean {
  switch (result.kind) {
    case 'blocked':
    case 'refused':
    case 'unsupported':
    case 'needs-permission':
    case 'failed':
    case 'copy-failed':
      return true;
    case 'busy':
    case 'cancelled':
    case 'copied':
    case 'attach':
    case 'edit':
      return false;
  }
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

export function screenCaptureCopyFailedMessage(locale: DesktopLocale): string {
  return locale === 'zh-CN'
    ? '截图没能复制到剪贴板，请重试。'
    : 'The screenshot could not be copied to the clipboard. Try again.';
}

/** The composer refused the image, but the clipboard still has it. */
export function screenCaptureCopiedInsteadMessage(locale: DesktopLocale, reason: string): string {
  return locale === 'zh-CN'
    ? `${reason}截图已复制到剪贴板。`
    : `${reason} The screenshot is on the clipboard.`;
}

export function screenCaptureUnsupportedMessage(locale: DesktopLocale): string {
  return locale === 'zh-CN'
    ? '当前平台暂不支持内置截屏。'
    : 'Built-in screenshots are not available on this platform yet.';
}
