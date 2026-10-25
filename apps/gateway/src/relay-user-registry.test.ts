import { describe, expect, it } from 'vitest';
import { createTestIdentity } from './relay-harness.fixture.js';
import {
  emptyRelayRegistry,
  parseRelayRegistry,
  RelayRegistryError,
  RelayUserRegistry,
} from './relay-user-registry.js';

function userEntry(overrides: Record<string, unknown> = {}) {
  const identity = createTestIdentity();
  return {
    identity,
    entry: {
      userId: identity.userId,
      publicKey: identity.userPublicKey,
      name: 'Yorick',
      ...overrides,
    },
  };
}

describe('parseRelayRegistry', () => {
  it('accepts a valid document and fills defaults', () => {
    const { entry } = userEntry({ limits: { maxHosts: 2 } });
    const hostId = createTestIdentity().hostId;
    expect(
      parseRelayRegistry({ version: 1, users: [entry], deniedHosts: [hostId, hostId] }),
    ).toEqual({
      version: 1,
      users: [{ ...entry, disabled: false, limits: { maxHosts: 2 } }],
      deniedHosts: [hostId],
    });
    expect(parseRelayRegistry({ version: 1 })).toEqual(emptyRelayRegistry());
  });

  it('rejects a userId that does not derive from its key', () => {
    const { entry } = userEntry({ userId: createTestIdentity().userId });
    expect(() => parseRelayRegistry({ version: 1, users: [entry] })).toThrow(RelayRegistryError);
  });

  it.each([
    ['wrong version', { version: 2, users: [] }],
    ['users not an array', { version: 1, users: {} }],
    ['bad key', { version: 1, users: [userEntry({ publicKey: 'AAAA' }).entry] }],
    ['empty name', { version: 1, users: [userEntry({ name: ' ' }).entry] }],
    ['disabled not boolean', { version: 1, users: [userEntry({ disabled: 'yes' }).entry] }],
    ['limit out of range', { version: 1, users: [userEntry({ limits: { maxHosts: 0 } }).entry] }],
    [
      'limit not integer',
      { version: 1, users: [userEntry({ limits: { maxPeersPerHost: 1.5 } }).entry] },
    ],
    ['bad denied host', { version: 1, deniedHosts: ['nope'] }],
    ['not an object', []],
  ])('rejects %s', (_label, document) => {
    expect(() => parseRelayRegistry(document)).toThrow(RelayRegistryError);
  });

  it('rejects the same user twice', () => {
    const { entry } = userEntry();
    expect(() => parseRelayRegistry({ version: 1, users: [entry, entry] })).toThrow(/repeats/);
  });
});

describe('RelayUserRegistry', () => {
  it('adds, finds, disables, removes and snapshots users', () => {
    const registry = new RelayUserRegistry();
    const { identity } = userEntry();
    const user = { userId: identity.userId, publicKey: identity.userPublicKey, name: 'Yorick' };
    expect(registry.addUser(user, { maxPeersPerHost: 4 })).toBe('added');
    expect(registry.addUser(user)).toBe('exists');
    expect(registry.find(identity.userId)).toMatchObject({
      disabled: false,
      limits: { maxPeersPerHost: 4 },
    });
    expect(registry.setDisabled(identity.userId, true)).toBe(true);
    expect(registry.find(identity.userId)?.disabled).toBe(true);
    expect(parseRelayRegistry(registry.snapshot())).toEqual(registry.snapshot());
    expect(registry.removeUser(identity.userId)).toBe(true);
    expect(registry.find(identity.userId)).toBeUndefined();
    expect(registry.setDisabled(identity.userId, false)).toBe(false);
  });

  it('refuses a user whose id does not match its key', () => {
    const registry = new RelayUserRegistry();
    const { identity } = userEntry();
    expect(() =>
      registry.addUser({
        userId: createTestIdentity().userId,
        publicKey: identity.userPublicKey,
        name: 'x',
      }),
    ).toThrow(RelayRegistryError);
  });

  it('denies and allows hosts', () => {
    const registry = new RelayUserRegistry();
    const { hostId } = createTestIdentity();
    expect(registry.setHostDenied(hostId, true)).toBe(true);
    expect(registry.setHostDenied(hostId, true)).toBe(false);
    expect(registry.isHostDenied(hostId)).toBe(true);
    expect(registry.setHostDenied(hostId, false)).toBe(true);
    expect(registry.isHostDenied(hostId)).toBe(false);
    expect(() => registry.setHostDenied('bad', true)).toThrow(RelayRegistryError);
  });

  it('hands out copies, not its own records', () => {
    const registry = new RelayUserRegistry();
    const { identity } = userEntry();
    registry.addUser({
      userId: identity.userId,
      publicKey: identity.userPublicKey,
      name: 'Yorick',
    });
    const copy = registry.find(identity.userId);
    if (copy) copy.disabled = true;
    expect(registry.find(identity.userId)?.disabled).toBe(false);
  });
});
