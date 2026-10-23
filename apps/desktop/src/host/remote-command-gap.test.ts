import { describe, expect, it } from 'vitest';
import { isRemoteCommandGapError } from './remote-command-gap.js';

describe('isRemoteCommandGapError', () => {
  it('matches HostServer admission denials', () => {
    expect(isRemoteCommandGapError('Remote command is not enabled yet: settings/get')).toBe(true);
    expect(isRemoteCommandGapError('Remote command is not enabled yet: plan/get')).toBe(true);
  });

  it('matches the HostClient ceiling message', () => {
    expect(
      isRemoteCommandGapError('This Host does not expose settings/get to remote clients'),
    ).toBe(true);
  });

  it('does not hide a failed settings save', () => {
    expect(
      isRemoteCommandGapError('Remote command is not enabled yet: settings/apply'),
    ).toBe(false);
    expect(
      isRemoteCommandGapError('This Host does not expose settings/apply to remote clients'),
    ).toBe(false);
  });

  it('leaves real failures alone', () => {
    expect(isRemoteCommandGapError('settings/get returned no snapshot')).toBe(false);
    expect(isRemoteCommandGapError('Host is offline')).toBe(false);
  });
});
