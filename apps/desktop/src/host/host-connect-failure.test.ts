import { describe, expect, it } from 'vitest';
import { HostHandshakeError, HostSocketClosedError } from '@piwin/host-transport';
import {
  classifyHostConnectFailure,
  describeHostConnectFailure,
  looksLikeBareSocketAddress,
  type HostConnectFailureCopy,
} from './host-connect-failure.js';

const COPY = {
  rejectReasons: { 'pairing-token-invalid': 'code expired' },
  channelFailures: { 'host-unavailable': 'host offline' },
  unreachable: 'cannot reach.',
  unreachableRelayHint: ' relay?',
  connectFailed: (detail: string) => `failed: ${detail}`,
} as unknown as HostConnectFailureCopy;

describe('classifyHostConnectFailure', () => {
  it('treats a socket that closed before the hello as unreachable', () => {
    const error = new HostSocketClosedError(
      'Host WebSocket closed before handshake (1006): Host WebSocket error',
      1006,
    );
    expect(classifyHostConnectFailure(error)).toEqual({ kind: 'unreachable' });
  });

  it('keeps the reason a Host gave when it refused', () => {
    const error = new HostHandshakeError('rejected', 4401, 'pairing-token-invalid');
    expect(classifyHostConnectFailure(error)).toEqual({
      kind: 'rejected',
      reason: 'pairing-token-invalid',
    });
  });

  it('names relay close codes', () => {
    const error = new HostSocketClosedError('closed', 4404);
    expect(classifyHostConnectFailure(error)).toEqual({
      kind: 'channel',
      failure: 'host-unavailable',
    });
  });

  it('recognizes plain transport messages and keeps anything else verbatim', () => {
    expect(classifyHostConnectFailure(new Error('Host connect timed out'))).toEqual({
      kind: 'unreachable',
    });
    expect(classifyHostConnectFailure(new Error('quota exceeded'))).toEqual({
      kind: 'other',
      detail: 'quota exceeded',
    });
  });
});

describe('describeHostConnectFailure', () => {
  it('adds the relay hint only for wss:// addresses', () => {
    expect(describeHostConnectFailure({ kind: 'unreachable' }, COPY, 'ws://10.0.0.2:8787')).toBe(
      'cannot reach.',
    );
    expect(
      describeHostConnectFailure({ kind: 'unreachable' }, COPY, 'wss://relay.example.com:8443'),
    ).toBe('cannot reach. relay?');
  });

  it('maps each kind to its copy', () => {
    expect(
      describeHostConnectFailure({ kind: 'rejected', reason: 'pairing-token-invalid' }, COPY),
    ).toBe('code expired');
    expect(describeHostConnectFailure({ kind: 'channel', failure: 'host-unavailable' }, COPY)).toBe(
      'host offline',
    );
    expect(describeHostConnectFailure({ kind: 'other', detail: 'x' }, COPY)).toBe('failed: x');
  });
});

describe('looksLikeBareSocketAddress', () => {
  it('spots an address pasted into the pairing-link field', () => {
    expect(looksLikeBareSocketAddress(' wss://relay.example.com:8443 ')).toBe(true);
    expect(looksLikeBareSocketAddress('piwin://pair?v=3&hostId=x')).toBe(false);
  });
});
