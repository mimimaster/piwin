import { describe, expect, it } from 'vitest';
import { parseRelayArgs, readIntegerFlag } from './relay-cli-args.js';
import { RelayEnrollToken } from './relay-enroll-token.js';
import { DEFAULT_RELAY_LIMITS, effectiveUserLimits, RelayRateLimiter } from './relay-limits.js';
import { createConsoleRelayLogger } from './relay-log.js';
import { RelayRooms } from './relay-rooms.js';

describe('RelayEnrollToken', () => {
  it('is absent when unset and refuses short tokens', () => {
    expect(RelayEnrollToken.fromEnvironment(undefined)).toBeUndefined();
    expect(RelayEnrollToken.fromEnvironment('   ')).toBeUndefined();
    expect(() => RelayEnrollToken.fromEnvironment('short')).toThrow();
  });

  it('matches only the exact token', () => {
    const token = RelayEnrollToken.fromEnvironment(' enroll-token-0123456789 ');
    expect(token?.matches('enroll-token-0123456789')).toBe(true);
    expect(token?.matches('enroll-token-012345678')).toBe(false);
    expect(token?.matches('enroll-token-01234567890')).toBe(false);
    expect(token?.matches(undefined)).toBe(false);
  });
});

describe('RelayRateLimiter', () => {
  it('allows N per window per key and resets after the window', () => {
    let now = 0;
    const limiter = new RelayRateLimiter(2, 1_000, () => now);
    expect([limiter.tryAcquire('a'), limiter.tryAcquire('a'), limiter.tryAcquire('a')]).toEqual([
      true,
      true,
      false,
    ]);
    expect(limiter.tryAcquire('b')).toBe(true);
    now = 1_000;
    expect(limiter.tryAcquire('a')).toBe(true);
  });
});

describe('effectiveUserLimits', () => {
  it('uses per-user overrides and falls back to defaults', () => {
    const user = {
      userId: 'u',
      publicKey: 'k',
      name: 'n',
      disabled: false,
      limits: { maxHosts: 2 },
    };
    expect(effectiveUserLimits(DEFAULT_RELAY_LIMITS, user)).toEqual({
      maxHosts: 2,
      maxPeersPerHost: 32,
    });
  });
});

describe('RelayRooms', () => {
  it('replaces a Host and ignores the late close of the replaced socket', () => {
    const rooms = new RelayRooms<string>();
    expect(rooms.attachHost('u', 'h', 'host-1')).toBeUndefined();
    expect(rooms.attachHost('u', 'h', 'host-2')).toBe('host-1');
    expect(rooms.detachHost('u', 'h', 'host-1')).toEqual([]);
    expect(rooms.findHost('u', 'h')).toBe('host-2');
  });

  it('assigns increasing peer ids, enforces the cap and frees ids on leave', () => {
    const rooms = new RelayRooms<string>();
    rooms.attachHost('u', 'h', 'host');
    expect(rooms.joinPeer('u', 'h', 'p1', 2)).toEqual({ peer: 1, host: 'host' });
    expect(rooms.joinPeer('u', 'h', 'p2', 2)).toEqual({ peer: 2, host: 'host' });
    expect(rooms.joinPeer('u', 'h', 'p3', 2)).toBeUndefined();
    expect(rooms.leavePeer('u', 'h', 1, 'other-socket')).toBe(false);
    expect(rooms.leavePeer('u', 'h', 1, 'p1')).toBe(true);
    expect(rooms.joinPeer('u', 'h', 'p3', 2)?.peer).toBe(3);
    expect(rooms.findPeer('u', 'h', 3)).toBe('p3');
  });

  it('counts Hosts per user and returns peers when a Host detaches', () => {
    const rooms = new RelayRooms<string>();
    rooms.attachHost('u', 'h1', 'a');
    rooms.attachHost('u', 'h2', 'b');
    rooms.attachHost('v', 'h3', 'c');
    rooms.joinPeer('u', 'h1', 'p', 8);
    expect(rooms.hostCount('u')).toBe(2);
    expect(rooms.detachHost('u', 'h1', 'a')).toEqual(['p']);
    expect(rooms.hostCount('u')).toBe(1);
    expect(rooms.joinPeer('u', 'h1', 'q', 8)).toBeUndefined();
    expect(
      rooms
        .listHosts()
        .map((entry) => entry.hostId)
        .sort(),
    ).toEqual(['h2', 'h3']);
  });

  it('drops every peer of a room', () => {
    const rooms = new RelayRooms<string>();
    rooms.attachHost('u', 'h', 'host');
    rooms.joinPeer('u', 'h', 'p1', 8);
    rooms.joinPeer('u', 'h', 'p2', 8);
    expect(rooms.dropPeers('u', 'h')).toEqual(['p1', 'p2']);
    expect(rooms.peerCount('u', 'h')).toBe(0);
  });
});

describe('relay CLI args', () => {
  it('parses positionals, valued and boolean flags', () => {
    const args = parseRelayArgs(['serve', '--port', '9', '--users=/x.json', '--trust-proxy']);
    expect(args.positionals).toEqual(['serve']);
    expect(Object.fromEntries(args.flags)).toEqual({
      port: '9',
      users: '/x.json',
      'trust-proxy': 'true',
    });
    expect(readIntegerFlag(args.flags, 'port', { min: 0, max: 65_535 })).toBe(9);
    expect(readIntegerFlag(args.flags, 'missing', { min: 0, max: 1 })).toBeUndefined();
  });

  it('rejects a missing value and out-of-range integers', () => {
    expect(() => parseRelayArgs(['--port'])).toThrow();
    expect(() =>
      readIntegerFlag(new Map([['port', '70000']]), 'port', { min: 0, max: 65_535 }),
    ).toThrow();
  });
});

describe('console relay logger', () => {
  it('shortens ids and redacts IPs unless asked to log them', () => {
    const lines: string[] = [];
    const log = createConsoleRelayLogger({ logIps: false, write: (line) => lines.push(line) });
    log({
      kind: 'peer-joined',
      userId: 'ABCDEFGHIJKLMNOPQRSTUV',
      hostId: 'abcdefghijklmnopqrstuv',
      peer: 1,
      peers: 1,
    });
    log({ kind: 'rate-limited', ip: '203.0.113.9' });
    expect(lines[0]).toContain('userId=ABCDEF ');
    expect(lines[0]).not.toContain('ABCDEFG');
    expect(lines[1]).toContain('ip=redacted');
    expect(lines[1]).not.toContain('203.0.113.9');
    const withIps: string[] = [];
    createConsoleRelayLogger({ logIps: true, write: (line) => withIps.push(line) })({
      kind: 'rate-limited',
      ip: '203.0.113.9',
    });
    expect(withIps[0]).toContain('ip=203.0.113.9');
  });
});
