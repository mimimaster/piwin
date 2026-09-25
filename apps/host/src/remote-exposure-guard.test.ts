import { describe, expect, it } from 'vitest';
import { findRemoteExposureWithoutToken } from './remote-exposure-guard.js';

describe('findRemoteExposureWithoutToken', () => {
  it('requires a token once a non-loopback address is advertised', () => {
    expect(
      findRemoteExposureWithoutToken({ advertisedUrl: 'wss://host.example.com', authToken: undefined }),
    ).toContain('PIWIN_HOST_TOKEN is not set');
    expect(
      findRemoteExposureWithoutToken({ advertisedUrl: 'ws://100.75.28.76:8787', authToken: undefined }),
    ).toContain('PIWIN_HOST_TOKEN');
    expect(findRemoteExposureWithoutToken({ advertisedUrl: 'nope', authToken: undefined })).toContain(
      'not a valid URL',
    );
  });

  it('allows loopback-only, unadvertised, or token-protected Hosts', () => {
    expect(findRemoteExposureWithoutToken({ advertisedUrl: undefined, authToken: undefined })).toBeUndefined();
    expect(findRemoteExposureWithoutToken({ advertisedUrl: '  ', authToken: undefined })).toBeUndefined();
    expect(
      findRemoteExposureWithoutToken({ advertisedUrl: 'ws://127.0.0.1:8787', authToken: undefined }),
    ).toBeUndefined();
    expect(
      findRemoteExposureWithoutToken({ advertisedUrl: 'wss://host.example.com', authToken: 'secret' }),
    ).toBeUndefined();
  });
});
