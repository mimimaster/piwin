import { describe, expect, it } from 'vitest';
import {
  compareClientVersions,
  isHostIngressBypassCommand,
  waitForSocketSendBudget,
} from './host-connection-lifecycle.js';

describe('host-connection-lifecycle', () => {
  it('compares dotted client versions for minClient gates', () => {
    expect(compareClientVersions('0.0.0', '0.1.0')).toBe(-1);
    expect(compareClientVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareClientVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareClientVersions('bogus', '1.0.0')).toBe(-1);
  });

  it('waits until the send budget clears', async () => {
    let buffered = 5_000_000;
    setTimeout(() => {
      buffered = 0;
    }, 30);
    await expect(
      waitForSocketSendBudget(() => buffered, { budgetBytes: 4_000_000, timeoutMs: 500, pollMs: 10 }),
    ).resolves.toBe(true);
  });

  it('bypasses ingress serialization for turn-control commands', () => {
    expect(isHostIngressBypassCommand('host/ping')).toBe(true);
    expect(isHostIngressBypassCommand('session/prompt')).toBe(true);
    expect(isHostIngressBypassCommand('session/abort')).toBe(true);
    expect(isHostIngressBypassCommand('session/list')).toBe(false);
    expect(isHostIngressBypassCommand('session/messages')).toBe(false);
  });
});
