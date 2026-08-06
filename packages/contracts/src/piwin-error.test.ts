import { describe, expect, it } from 'vitest';
import {
  PiwinError,
  formatError,
  toErrorView,
  isCancellation,
  formatHostError,
  type PiwinErrorCategory,
} from './piwin-error.js';

describe('PiwinError', () => {
  it('sets code, category, and retryable from options', () => {
    class ConfigError extends PiwinError {
      constructor(message: string) {
        super('config-invalid', message, { category: 'config', retryable: false });
      }
    }
    const error = new ConfigError('Missing API key');
    expect(error.code).toBe('config-invalid');
    expect(error.category).toBe('config');
    expect(error.retryable).toBe(false);
    expect(error.message).toBe('Missing API key');
    expect(error.name).toBe('ConfigError');
    expect(error instanceof PiwinError).toBe(true);
    expect(error instanceof Error).toBe(true);
  });

  it('defaults category to unknown and retryable to false', () => {
    const error = new PiwinError('some-code', 'something happened');
    expect(error.category).toBe('unknown');
    expect(error.retryable).toBe(false);
  });

  it('toView serializes structured fields', () => {
    const error = new PiwinError('session-not-found', 'Session not found', {
      category: 'not-found',
      retryable: true,
    });
    expect(error.toView()).toEqual({
      category: 'not-found',
      message: 'Session not found',
      code: 'session-not-found',
      retryable: true,
    });
  });

  it('toView omits retryable when false', () => {
    const error = new PiwinError('some-code', 'fail', { category: 'execution' });
    expect(error.toView()).toEqual({
      category: 'execution',
      message: 'fail',
      code: 'some-code',
    });
  });

  it('preserves cause via Error options', () => {
    const cause = new Error('root cause');
    const error = new PiwinError('wrapped', 'wrapper message', { cause });
    expect((error as Error & { cause?: unknown }).cause).toBe(cause);
  });

  it('subclass instanceof checks work correctly', () => {
    class NotFoundError extends PiwinError {
      constructor() {
        super('not-found', 'Not found', { category: 'not-found' });
      }
    }
    const error = new NotFoundError();
    expect(error instanceof NotFoundError).toBe(true);
    expect(error instanceof PiwinError).toBe(true);
    expect(error instanceof Error).toBe(true);
  });
});

describe('formatError', () => {
  it('returns PiwinError.message directly', () => {
    const error = new PiwinError('test-code', 'curated message');
    expect(formatError(error)).toBe('curated message');
  });

  it('returns Error.message when non-empty', () => {
    expect(formatError(new Error('plain error'))).toBe('plain error');
  });

  it('falls back to error name when message is empty', () => {
    class CustomError extends Error {
      constructor() {
        super('');
        this.name = 'CustomError';
      }
    }
    expect(formatError(new CustomError())).toBe('CustomError');
  });

  it('falls back to generic message for empty Error', () => {
    expect(formatError(new Error(''))).toBe('An unexpected error occurred.');
  });

  it('returns trimmed string values', () => {
    expect(formatError('  hello  ')).toBe('hello');
  });

  it('returns generic message for empty string', () => {
    expect(formatError('')).toBe('An unexpected error occurred.');
  });

  it('handles null and undefined', () => {
    expect(formatError(null)).toBe('An unexpected error occurred.');
    expect(formatError(undefined)).toBe('An unexpected error occurred.');
  });

  it('stringifies other values', () => {
    expect(formatError(42)).toBe('42');
    expect(formatError({ key: 'val' })).toBe('[object Object]');
  });

  it('handles objects that throw on toString', () => {
    const evil = {
      toString() {
        throw new Error('cannot stringify');
      },
    };
    expect(formatError(evil)).toBe('An unexpected error occurred.');
  });
});

describe('toErrorView', () => {
  it('preserves PiwinError structured fields', () => {
    const error = new PiwinError('provider-fail', 'Provider down', {
      category: 'provider',
      retryable: true,
    });
    expect(toErrorView(error)).toEqual({
      category: 'provider',
      message: 'Provider down',
      code: 'provider-fail',
      retryable: true,
    });
  });

  it('defaults to unknown category for plain Error', () => {
    const view = toErrorView(new Error('boom'));
    expect(view.category).toBe('unknown');
    expect(view.message).toBe('boom');
    expect(view.code).toBeUndefined();
    expect(view.retryable).toBeUndefined();
  });

  it('handles non-Error values', () => {
    const view = toErrorView('something went wrong');
    expect(view.category).toBe('unknown');
    expect(view.message).toBe('something went wrong');
  });
});

describe('isCancellation', () => {
  it('returns true for PiwinError with cancelled category', () => {
    const error = new PiwinError('aborted', 'Operation cancelled', {
      category: 'cancelled',
    });
    expect(isCancellation(error)).toBe(true);
  });

  it('returns true for AbortError name', () => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    expect(isCancellation(error)).toBe(true);
  });

  it('returns true for error message containing aborted', () => {
    expect(isCancellation(new Error('Request was aborted by user'))).toBe(true);
  });

  it('returns true for error message containing cancelled', () => {
    expect(isCancellation(new Error('Task was cancelled'))).toBe(true);
  });

  it('returns true for string containing cancelled', () => {
    expect(isCancellation('operation cancelled')).toBe(true);
  });

  it('returns false for non-cancellation errors', () => {
    expect(isCancellation(new Error('Network timeout'))).toBe(false);
    expect(isCancellation('something else')).toBe(false);
    expect(isCancellation(42)).toBe(false);
    expect(isCancellation(null)).toBe(false);
  });
});

describe('formatHostError', () => {
  it('wraps error with command context prefix', () => {
    expect(formatHostError('session/prompt', new Error('model unavailable'))).toBe(
      "host command 'session/prompt' failed: model unavailable",
    );
  });

  it('works with PiwinError', () => {
    const error = new PiwinError('not-found', 'Session not found', {
      category: 'not-found',
    });
    expect(formatHostError('session/list', error)).toBe(
      "host command 'session/list' failed: Session not found",
    );
  });

  it('handles string errors', () => {
    expect(formatHostError('host/ping', 'timeout')).toBe(
      "host command 'host/ping' failed: timeout",
    );
  });
});
