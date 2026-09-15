import { describe, expect, it } from 'vitest';
import {
  AbortOperationError,
  BrowserRuntimeGoneError,
  BrowserSessionError,
  BrowserStaleTargetError,
  BrowserUnavailableError,
  BrowserUserHasControlError,
} from '@piwin/browser';
import {
  mapBrowserExecuteError,
  mapBrowserToolError,
  sanitizeBrowserErrorMessage,
  userControlResult,
} from './browser-tool-errors.js';

function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe('mapBrowserToolError', () => {
  it('maps BrowserUserHasControlError as non-retryable', () => {
    const result = mapBrowserToolError(
      new BrowserUserHasControlError('The user has the browser.'),
    );
    expect(result).toMatchObject({
      ok: false,
      code: 'browser-user-has-control',
      retryable: false,
      message: 'The user has the browser.',
      details: { recoveryAction: 'wait-for-user-handoff' },
    });
  });

  it('maps duck-typed BrowserUserHasControlError by name', () => {
    const result = mapBrowserToolError(
      namedError('BrowserUserHasControlError', 'The user has the browser.'),
    );
    expect(result).toMatchObject({
      ok: false,
      code: 'browser-user-has-control',
      retryable: false,
    });
  });

  it('maps agent-has-control from BrowserSessionError message', () => {
    const result = mapBrowserToolError(new BrowserSessionError('The agent is using the browser.'));
    expect(result).toMatchObject({
      ok: false,
      code: 'browser-agent-has-control',
      retryable: false,
    });
  });

  it('maps BrowserRuntimeGoneError as retryable', () => {
    const result = mapBrowserToolError(new BrowserRuntimeGoneError('browser context is gone'));
    expect(result).toMatchObject({
      ok: false,
      code: 'browser-runtime-gone',
      retryable: true,
    });
  });

  it('maps BrowserUnavailableError as non-retryable', () => {
    const result = mapBrowserToolError(
      new BrowserUnavailableError("Executable doesn't exist at /opt/chromium"),
    );
    expect(result).toMatchObject({
      ok: false,
      code: 'browser-unavailable',
      retryable: false,
    });
  });

  it('maps BrowserStaleTargetError as non-retryable with pageStateLost', () => {
    const result = mapBrowserToolError(
      new BrowserStaleTargetError('snapshot ref is stale', { pageStateLost: true }),
    );
    expect(result).toMatchObject({
      ok: false,
      code: 'browser-stale-target',
      retryable: false,
      details: { outcome: 'not-started', pageStateLost: true },
    });
  });

  it('maps AbortOperationError to aborted', () => {
    const result = mapBrowserToolError(new AbortOperationError('operation aborted'));
    expect(result).toMatchObject({
      ok: false,
      code: 'aborted',
      retryable: false,
      message: 'operation aborted',
    });
  });

  it('returns undefined for unknown errors', () => {
    expect(mapBrowserToolError(new Error('boom'))).toBeUndefined();
  });
});

describe('sanitizeBrowserErrorMessage', () => {
  it('strips Playwright Call log and bounds the message', () => {
    const callLog = 'x'.repeat(80);
    const error = new BrowserUnavailableError(
      `locator.click: Timeout 8000ms exceeded.\nCall log:\n  - waiting for ${callLog}\nCookie: session=super-secret`,
    );
    const message = sanitizeBrowserErrorMessage(error);
    expect(message).toBe('locator.click: Timeout 8000ms exceeded.');
    expect(message).not.toContain('Call log');
    expect(message).not.toContain('super-secret');
  });

  it('redacts cookie values and credential URLs', () => {
    const message = sanitizeBrowserErrorMessage(
      new Error('fetch failed Cookie: sid=abc https://user:pass@example.com/path'),
    );
    expect(message).toContain('cookie=<redacted>');
    expect(message).toContain('https://<redacted>@example.com/path');
    expect(message).not.toContain('sid=abc');
    expect(message).not.toContain('user:pass');
  });

  it('truncates messages to 500 characters', () => {
    const message = sanitizeBrowserErrorMessage(new Error('e'.repeat(600)));
    expect(message.length).toBe(501);
    expect(message.endsWith('…')).toBe(true);
  });
});

describe('userControlResult', () => {
  it('returns mapped ToolResult for known browser errors', () => {
    expect(
      userControlResult(new BrowserUserHasControlError('The user has the browser.')),
    ).toMatchObject({ ok: false, code: 'browser-user-has-control' });
  });

  it('rethrows unmapped errors', () => {
    expect(() => userControlResult(new Error('not a browser error'))).toThrow(
      'not a browser error',
    );
  });
});

describe('mapBrowserExecuteError', () => {
  it('maps overlay intercept to snapshot-or-dismiss-overlay', () => {
    const result = mapBrowserExecuteError(
      new Error('<div> intercepts pointer events'),
      'click',
    );
    expect(result).toMatchObject({
      ok: false,
      code: 'browser-action-failed',
      details: { reason: 'overlay', recoveryAction: 'snapshot-or-dismiss-overlay' },
    });
  });
});
