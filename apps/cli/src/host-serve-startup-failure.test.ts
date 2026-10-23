import { afterEach, describe, expect, it, vi } from 'vitest';
import { PiwinRootAlreadyOwnedError, PiwinRootOwnershipUnknownError } from '@piwin/host-runtime';
import {
  HOST_STARTUP_FATAL_EXIT_CODE,
  HOST_STARTUP_FATAL_PREFIX,
  describeStartupFailure,
  reportDeterministicStartupFailure,
} from './host-serve-startup-failure.js';

const owner = {
  schemaVersion: 1 as const,
  leaseId: 'lease',
  hostInstanceId: 'host',
  processId: 885,
  processStartedAt: '2026-10-22T00:00:00.000Z',
  acquiredAt: '2026-10-22T00:00:00.000Z',
  ownerKind: 'cli-command' as const,
};

describe('host serve startup failure', () => {
  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('reports an owned root with the fatal marker and exit code', () => {
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    const reported = reportDeterministicStartupFailure(
      new PiwinRootAlreadyOwnedError(owner),
      '/Users/a/.piwin',
    );
    expect(reported).toBe(true);
    expect(process.exitCode).toBe(HOST_STARTUP_FATAL_EXIT_CODE);
    expect(lines).toEqual([
      `${HOST_STARTUP_FATAL_PREFIX}/Users/a/.piwin is in use by another piwin process (pid 885). Quit that process, then reopen piwin.`,
    ]);
  });

  it('tells the user how to clear an unprovable owner', () => {
    expect(
      describeStartupFailure(new PiwinRootOwnershipUnknownError('boom'), '/Users/a/.piwin'),
    ).toContain('/Users/a/.piwin/.host/owner.lock');
  });

  it('leaves other errors to the ordinary crash path', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(reportDeterministicStartupFailure(new Error('boom'), '/root')).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });
});
