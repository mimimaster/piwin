import { describe, expect, it } from 'vitest';
import { toolOutputDuplicatesError } from './tool-output-duplicates-error.js';

describe('toolOutputDuplicatesError', () => {
  it('treats identical output and error message as duplicate', () => {
    expect(
      toolOutputDuplicatesError('Permission denied', {
        category: 'permission',
        message: 'Permission denied',
      }),
    ).toBe(true);
  });

  it('treats Tool error wrappers around the same message as duplicate', () => {
    expect(
      toolOutputDuplicatesError('Tool error (execution-failed): Command failed', {
        category: 'execution',
        message: 'Command failed',
      }),
    ).toBe(true);
  });

  it('treats category-prefixed output as duplicate', () => {
    expect(
      toolOutputDuplicatesError('execution: Command failed', {
        category: 'execution',
        message: 'Command failed',
      }),
    ).toBe(true);
  });

  it('keeps long stderr that only shares a short error prefix', () => {
    const stderr = [
      'Command failed: ls /missing',
      'ls: /missing: No such file or directory',
      'stack: at runShell (host.js:12)',
      'stack: at dispatch (host.js:40)',
    ].join('\n');
    expect(
      toolOutputDuplicatesError(stderr, {
        category: 'execution',
        message: 'Command failed: ls /missing',
      }),
    ).toBe(false);
  });

  it('returns false when either side is missing', () => {
    expect(toolOutputDuplicatesError(undefined, { category: 'execution', message: 'x' })).toBe(
      false,
    );
    expect(toolOutputDuplicatesError('x', undefined)).toBe(false);
  });
});
