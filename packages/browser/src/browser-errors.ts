/**
 * Browser-session error classes. `code` values match `@piwin/contracts`
 * ToolResultErrorCode so Host/SDK/RPC can map without parsing messages.
 */
import {
  BROWSER_RUNTIME_GONE,
  BROWSER_STALE_TARGET,
  BROWSER_UNAVAILABLE,
  BROWSER_USER_HAS_CONTROL,
} from '@piwin/contracts';

export class BrowserSessionError extends Error {
  override name: string = 'BrowserSessionError';
}

export class NavigateError extends BrowserSessionError {
  override name: string = 'NavigateError';
}

export class BrowserUnavailableError extends BrowserSessionError {
  override name: string = 'BrowserUnavailableError';
  readonly code = BROWSER_UNAVAILABLE;
  readonly reason?: 'binary-missing' | 'profile-in-use' | 'startup-failed';

  constructor(
    message: string,
    options?: { cause?: unknown; reason?: 'binary-missing' | 'profile-in-use' | 'startup-failed' },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : {});
    if (options?.reason !== undefined) this.reason = options.reason;
  }
}

export class AbortOperationError extends BrowserSessionError {
  override name: string = 'AbortOperationError';
}

export class BrowserSessionClosedError extends BrowserSessionError {
  override name: string = 'BrowserSessionClosedError';
}

export class BrowserUserHasControlError extends BrowserSessionError {
  override name: string = 'BrowserUserHasControlError';
  readonly code = BROWSER_USER_HAS_CONTROL;
}

export class BrowserRuntimeGoneError extends BrowserSessionError {
  override name: string = 'BrowserRuntimeGoneError';
  readonly code = BROWSER_RUNTIME_GONE;
}

export class BrowserStaleTargetError extends BrowserSessionError {
  override name: string = 'BrowserStaleTargetError';
  readonly code = BROWSER_STALE_TARGET;
  readonly pageStateLost: boolean;

  constructor(message: string, options?: { pageStateLost?: boolean; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : {});
    this.pageStateLost = options?.pageStateLost ?? true;
  }
}

/**
 * Fallback classifier for Playwright/CDP death strings. Prefer `page.isClosed()`
 * / `browser.isConnected()` / lifecycle events; a "session closed" message is
 * not by itself process death (CDP screencast detach leaves the page alive).
 */
export function isDeadBrowserError(error: unknown): boolean {
  const text = errorText(error);
  if (text === '') return false;
  return (
    /target closed/i.test(text) ||
    /target page, context or browser has been closed/i.test(text) ||
    /browser has been closed/i.test(text) ||
    /browser closed/i.test(text) ||
    /connection closed/i.test(text) ||
    /session closed/i.test(text) ||
    /cdp session.*closed/i.test(text)
  );
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '';
}
