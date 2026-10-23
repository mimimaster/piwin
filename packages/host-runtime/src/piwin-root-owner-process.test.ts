import { describe, expect, it } from 'vitest';
import { isSameOwnerProcess, PROCESS_START_TOLERANCE_MS } from './piwin-root-owner-process.js';

const NOW_MS = Date.parse('2026-10-23T14:09:14Z');
const STARTED_AT = new Date(NOW_MS - 3_600_000).toISOString();
const HOST_COMMAND = '/Applications/piwin.app/Contents/MacOS/piwin-host host-serve.mjs host serve';

describe('root owner process identity', () => {
  it('accepts the same process within the ps rounding tolerance', () => {
    const facts = { parentProcessId: 1, elapsedMs: 3_600_000 - 900, command: HOST_COMMAND };
    expect(isSameOwnerProcess({ processStartedAt: STARTED_AT }, facts, NOW_MS)).toBe(true);
  });

  it('rejects a PID whose process started at another time', () => {
    const facts = {
      parentProcessId: 1,
      elapsedMs: 3_600_000 - PROCESS_START_TOLERANCE_MS - 1_000,
      command: HOST_COMMAND,
    };
    expect(isSameOwnerProcess({ processStartedAt: STARTED_AT }, facts, NOW_MS)).toBe(false);
  });

  it('rejects a PID running another executable when the record names one', () => {
    const identity = {
      processStartedAt: STARTED_AT,
      processExecPath: '/Applications/piwin.app/Contents/MacOS/piwin-host',
    };
    const facts = { parentProcessId: 1, elapsedMs: 3_600_000, command: '/usr/libexec/agent' };
    expect(isSameOwnerProcess(identity, facts, NOW_MS)).toBe(false);
    expect(isSameOwnerProcess(identity, { ...facts, command: HOST_COMMAND }, NOW_MS)).toBe(true);
  });
});
