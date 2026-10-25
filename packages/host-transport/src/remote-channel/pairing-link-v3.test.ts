import type { PairingLinkV3 } from '@piwin/contracts';
import { describe, expect, it } from 'vitest';
import { encodeBase64Url } from './base64url.js';
import {
  encodePairingLinkV3,
  encodePairingWebLink,
  parsePairingLinkV3,
} from './pairing-link-v3.js';

const LINK: PairingLinkV3 = {
  v: 3,
  userId: 'AbCdEfGhIjKlMnOpQrSt_-',
  userName: 'Yorick',
  hostId: 'ZyXwVuTsRqPoNmLkJiHg-_',
  hostName: "Yorick's MacBook",
  hostKey: encodeBase64Url(new Uint8Array(32).fill(9)),
  relayUrl: 'wss://relay.example.com',
  directUrl: 'ws://192.168.1.20:8790',
  pairingToken: 'token-abc',
  role: 'member',
  expiresAt: 1_900_000_000_000,
};

describe('pairing link v3', () => {
  it('round-trips the native form', () => {
    const text = encodePairingLinkV3(LINK);
    expect(text.startsWith('piwin://pair?v=3&')).toBe(true);
    expect(parsePairingLinkV3(text)).toEqual(LINK);
  });

  it('round-trips the web form with the payload in the fragment', () => {
    const text = encodePairingWebLink('wss://relay.example.com', LINK);
    expect(text.startsWith('https://relay.example.com/#pair=')).toBe(true);
    expect(parsePairingLinkV3(text)).toEqual(LINK);
    expect(
      encodePairingWebLink('ws://localhost:7466', LINK).startsWith('http://localhost:7466/#pair='),
    ).toBe(true);
  });

  it('accepts a relay-only or direct-only link', () => {
    const { directUrl: _direct, ...relayOnly } = LINK;
    const { relayUrl: _relay, ...directOnly } = LINK;
    expect(parsePairingLinkV3(encodePairingLinkV3(relayOnly))).toEqual(relayOnly);
    expect(parsePairingLinkV3(encodePairingLinkV3(directOnly))).toEqual(directOnly);
  });

  it.each([
    ['no address at all', { relayUrl: undefined, directUrl: undefined }],
    ['a cleartext public relay', { relayUrl: 'ws://relay.example.com' }],
    ['a non-websocket relay', { relayUrl: 'https://relay.example.com' }],
    ['a bad user id', { userId: 'short' }],
    ['a short host key', { hostKey: encodeBase64Url(new Uint8Array(31)) }],
    ['an unknown role', { role: 'admin' }],
    ['an empty token', { pairingToken: '' }],
    ['an empty host name', { hostName: '  ' }],
  ])('rejects %s', (_label, overrides) => {
    const broken = { ...LINK, ...overrides } as Record<string, unknown>;
    for (const key of Object.keys(broken)) if (broken[key] === undefined) delete broken[key];
    expect(parsePairingLinkV3(encodePairingLinkV3(broken as PairingLinkV3))).toBeUndefined();
  });

  it('allows a localhost relay over ws:// for development', () => {
    const local = { ...LINK, relayUrl: 'ws://localhost:7466' };
    expect(parsePairingLinkV3(encodePairingLinkV3(local))?.relayUrl).toBe('ws://localhost:7466');
  });

  it('rejects other link versions and garbage', () => {
    expect(parsePairingLinkV3(encodePairingLinkV3(LINK).replace('v=3', 'v=2'))).toBeUndefined();
    expect(parsePairingLinkV3('piwin://pair?endpoint=ws://x&pairingToken=t')).toBeUndefined();
    expect(parsePairingLinkV3('https://relay.example.com/#pair=!!!')).toBeUndefined();
    expect(parsePairingLinkV3('hello')).toBeUndefined();
  });
});
