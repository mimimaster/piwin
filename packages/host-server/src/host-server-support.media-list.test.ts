import { describe, expect, it } from 'vitest';
import type { HostCommand } from '@piwin/contracts';
import { isSafeRemoteCommand } from './host-server-support.js';

describe('isSafeRemoteCommand media/list', () => {
  it('accepts the library default payload', () => {
    const command = { type: 'media/list', input: { limit: 40 } } satisfies HostCommand;
    expect(isSafeRemoteCommand(command)).toBe(true);
  });

  it('accepts mixed library without kind', () => {
    expect(isSafeRemoteCommand({ type: 'media/list', input: {} })).toBe(true);
  });

  it('rejects kind=all at the wire boundary', () => {
    expect(
      isSafeRemoteCommand({
        type: 'media/list',
        input: { kind: 'all' as 'image' },
      }),
    ).toBe(false);
  });

  it('rejects missing input without throwing', () => {
    expect(isSafeRemoteCommand({ type: 'media/list' } as HostCommand)).toBe(false);
  });
});
