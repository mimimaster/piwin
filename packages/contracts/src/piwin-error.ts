/**
 * Unified error handling contracts for piwin.
 *
 * Every layer (CLI, Desktop, host-runtime, agent-host) normalizes caught
 * values through {@link formatError} and maps structured errors to
 * user-facing messages via {@link toUserMessage}. Domain-specific Error
 * subclasses extend {@link PiwinError} to carry a stable `code` and optional
 * `cause` without each package reinventing the pattern.
 *
 * Design constraints:
 * - Contracts must stay leaf (no runtime deps on other @piwin/* packages).
 * - The module is importable from both Node (CLI/host) and browser (Desktop).
 * - `PiwinError` is a real class (not just a type) so `instanceof` works
 *   across package boundaries without symbol-based branding.
 */

/**
 * Stable, coarse-grained error categories that cross the IPC boundary.
 *
 * These are intentionally broader than domain-specific codes (e.g.
 * `ToolResultErrorCode`, `WalkthroughErrorCode`). Domain packages may
 * carry finer-grained codes on their own Error subclasses; the host
 * maps them to one of these categories when building a `HostResponse`.
 */
export type PiwinErrorCategory =
  | 'config'
  | 'permission'
  | 'not-found'
  | 'validation'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'provider'
  | 'execution'
  | 'unknown';

/**
 * Structured error view that can be embedded in IPC responses or push
 * events without leaking internal stack traces or secrets.
 */
export type PiwinErrorView = {
  category: PiwinErrorCategory;
  message: string;
  /** Stable domain code when available (e.g. 'tool-disabled', 'session-not-found'). */
  code?: string;
  /** True when the caller may retry the same operation. */
  retryable?: boolean;
};

/**
 * Base class for all piwin domain errors.
 *
 * Subclasses set a stable `code` and optionally a `category`. The `message`
 * is safe for user display (no secrets, no raw provider bodies).
 *
 * @example
 * ```ts
 * class SessionNotFoundError extends PiwinError {
 *   constructor(sessionId: string) {
 *     super('session-not-found', `Session "${sessionId}" was not found.`, {
 *       category: 'not-found',
 *     });
 *   }
 * }
 * ```
 */
export class PiwinError extends Error {
  readonly code: string;
  readonly category: PiwinErrorCategory;
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    options?: {
      category?: PiwinErrorCategory;
      cause?: unknown;
      retryable?: boolean;
    },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    this.category = options?.category ?? 'unknown';
    this.retryable = options?.retryable ?? false;
    // Maintain proper prototype chain when transpiled to ES5
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Convert to a serializable {@link PiwinErrorView} for IPC / push events.
   */
  toView(): PiwinErrorView {
    return {
      category: this.category,
      message: this.message,
      code: this.code,
      ...(this.retryable ? { retryable: true } : {}),
    };
  }
}

/**
 * Normalize any caught value (Error, PiwinError, string, unknown) into a
 * safe user-facing message string.
 *
 * This replaces the ad-hoc `error instanceof Error ? error.message : String(error)`
 * pattern duplicated 140+ times across the codebase.
 *
 * - `PiwinError` → uses its `.message` (already curated for users)
 * - `Error` → uses `.message`, trimming if non-empty
 * - `string` → returned as-is (trimmed)
 * - everything else → `String(value)` with a fallback
 */
export function formatError(error: unknown): string {
  if (error instanceof PiwinError) {
    return error.message;
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message !== '') {
      return message;
    }
    // Fall back to the error name if message is empty
    return error.name !== 'Error' ? error.name : 'An unexpected error occurred.';
  }
  if (typeof error === 'string') {
    const trimmed = error.trim();
    return trimmed !== '' ? trimmed : 'An unexpected error occurred.';
  }
  if (error === null || error === undefined) {
    return 'An unexpected error occurred.';
  }
  try {
    const str = String(error);
    return str !== '' ? str : 'An unexpected error occurred.';
  } catch {
    return 'An unexpected error occurred.';
  }
}

/**
 * Extract a {@link PiwinErrorView} from any caught value.
 *
 * When the value is a `PiwinError`, its structured fields are preserved.
 * For plain `Error` or other values, the category defaults to `'unknown'`
 * and the message is normalized via {@link formatError}.
 */
export function toErrorView(error: unknown): PiwinErrorView {
  if (error instanceof PiwinError) {
    return error.toView();
  }
  return {
    category: 'unknown',
    message: formatError(error),
  };
}

/**
 * True when the caught value represents a cancellation / abort rather than
 * a real failure. Useful for suppressing error UI on user-initiated cancels.
 */
export function isCancellation(error: unknown): boolean {
  if (error instanceof PiwinError) {
    return error.category === 'cancelled';
  }
  if (error instanceof Error) {
    return (
      error.name === 'AbortError' ||
      error.message.toLowerCase().includes('aborted') ||
      error.message.toLowerCase().includes('cancelled')
    );
  }
  if (typeof error === 'string') {
    const lower = error.toLowerCase();
    return lower.includes('aborted') || lower.includes('cancelled');
  }
  return false;
}

/**
 * Build a `HostResponse`-compatible error string with a command context prefix.
 *
 * Used by the host serve dispatcher and desktop host-client to wrap caught
 * errors into the `HostResponse` `error` field.
 */
export function formatHostError(commandType: string, error: unknown): string {
  const message = formatError(error);
  return `host command '${commandType}' failed: ${message}`;
}
