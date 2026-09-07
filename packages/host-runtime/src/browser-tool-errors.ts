/**
 * Map browser session errors onto Host `ToolResult` codes (completeness §4.3).
 *
 * Known session/Playwright failures become stable codes shared by tools and
 * IPC. Unmapped errors still throw from `userControlResult` so admission can
 * classify them. Messages are bounded and stripped of Playwright Call logs.
 */
import {
  AbortOperationError,
  BrowserRuntimeGoneError,
  BrowserStaleTargetError,
  BrowserUnavailableError,
  BrowserUserHasControlError,
} from '@piwin/browser';
import {
  BROWSER_AGENT_HAS_CONTROL,
  BROWSER_RUNTIME_GONE,
  BROWSER_STALE_TARGET,
  BROWSER_UNAVAILABLE,
  BROWSER_USER_HAS_CONTROL,
  type ToolResult,
  type ToolResultDetails,
  type ToolResultErrorCode,
} from '@piwin/contracts';

const MAX_BROWSER_ERROR_MESSAGE_CHARS = 500;
const AGENT_HAS_CONTROL_MESSAGE = /agent is using the browser/i;

export function sanitizeBrowserErrorMessage(error: unknown): string {
  let message = messageOf(error);
  const callLog = /\r?\nCall log:/i.exec(message);
  if (callLog && callLog.index !== undefined) {
    message = message.slice(0, callLog.index);
  }
  message = message.replace(/https?:\/\/[^/\s]*:[^/\s]*@/gi, (match) => {
    const scheme = match.toLowerCase().startsWith('https') ? 'https://' : 'http://';
    return `${scheme}<redacted>@`;
  });
  message = message.replace(/\b(?:set-)?cookie\b\s*[:=]\s*[^\s;]+/gi, 'cookie=<redacted>');
  message = message.replace(/\s+/g, ' ').trim();
  if (message.length === 0) {
    message = 'browser command failed';
  }
  if (message.length > MAX_BROWSER_ERROR_MESSAGE_CHARS) {
    return `${message.slice(0, MAX_BROWSER_ERROR_MESSAGE_CHARS)}…`;
  }
  return message;
}

export type MappedBrowserToolError = Extract<ToolResult, { ok: false }>;

export function mapBrowserToolError(error: unknown): MappedBrowserToolError | undefined {
  if (
    isErrorNamed(error, 'BrowserUserHasControlError') ||
    hasErrorCode(error, BROWSER_USER_HAS_CONTROL)
  ) {
    return mappedResult('browser-user-has-control', error, { retryable: false });
  }
  if (
    isErrorNamed(error, 'BrowserAgentHasControlError') ||
    hasErrorCode(error, BROWSER_AGENT_HAS_CONTROL)
  ) {
    return mappedResult('browser-agent-has-control', error, { retryable: false });
  }
  if (
    isErrorNamed(error, 'BrowserRuntimeGoneError') ||
    hasErrorCode(error, BROWSER_RUNTIME_GONE)
  ) {
    return mappedResult('browser-runtime-gone', error, { retryable: true });
  }
  if (
    isErrorNamed(error, 'BrowserUnavailableError') ||
    hasErrorCode(error, BROWSER_UNAVAILABLE)
  ) {
    return mappedResult('browser-unavailable', error, { retryable: false });
  }
  if (
    isErrorNamed(error, 'BrowserStaleTargetError') ||
    hasErrorCode(error, BROWSER_STALE_TARGET)
  ) {
    return mappedResult('browser-stale-target', error, {
      retryable: false,
      details: { outcome: 'not-started', pageStateLost: readPageStateLost(error) },
    });
  }
  if (error instanceof AbortOperationError || isErrorNamed(error, 'AbortOperationError')) {
    return mappedResult('aborted', error, { retryable: false });
  }
  if (error instanceof Error && AGENT_HAS_CONTROL_MESSAGE.test(error.message)) {
    return mappedResult('browser-agent-has-control', error, { retryable: false });
  }
  return undefined;
}

/**
 * Tool executors catch session failures here. Mapped codes return; anything
 * else is rethrown for the execution router.
 */
export function userControlResult(error: unknown): ToolResult {
  const mapped = mapBrowserToolError(error);
  if (mapped) return mapped;
  throw error;
}

function mappedResult(
  code: ToolResultErrorCode,
  error: unknown,
  options: { retryable: boolean; details?: ToolResultDetails },
): MappedBrowserToolError {
  return {
    ok: false,
    code,
    message: sanitizeBrowserErrorMessage(error),
    retryable: options.retryable,
    ...(options.details !== undefined ? { details: options.details } : {}),
  };
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  if (typeof error === 'string' && error.length > 0) return error;
  return 'browser command failed';
}

function isErrorNamed(error: unknown, name: string): boolean {
  if (name === 'BrowserUserHasControlError' && error instanceof BrowserUserHasControlError) {
    return true;
  }
  if (name === 'BrowserRuntimeGoneError' && error instanceof BrowserRuntimeGoneError) {
    return true;
  }
  if (name === 'BrowserUnavailableError' && error instanceof BrowserUnavailableError) {
    return true;
  }
  if (name === 'BrowserStaleTargetError' && error instanceof BrowserStaleTargetError) {
    return true;
  }
  return error instanceof Error && error.name === name;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function readPageStateLost(error: unknown): boolean {
  if (error instanceof BrowserStaleTargetError) return error.pageStateLost;
  if (typeof error === 'object' && error !== null && 'pageStateLost' in error) {
    return error.pageStateLost === true;
  }
  return true;
}
