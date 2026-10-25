import { describe, expect, it } from 'vitest';
import {
  decodeRelayControlFrame,
  isRemoteChannelPathname,
  isRemoteId,
  parseRemoteChannelPath,
  remoteChannelPath,
} from './remote-channel.js';

const USER_ID = 'AbCdEfGhIjKlMnOpQrSt_-';

describe('remote ids', () => {
  it('accepts exactly 22 base64url characters', () => {
    expect(isRemoteId(USER_ID)).toBe(true);
    expect(isRemoteId(USER_ID.slice(1))).toBe(false);
    expect(isRemoteId(`${USER_ID}A`)).toBe(false);
    expect(isRemoteId('AbCdEfGhIjKlMnOpQrSt+/')).toBe(false);
    expect(isRemoteId(42)).toBe(false);
  });
});

describe('remote channel paths', () => {
  it('round-trips host and connect routes', () => {
    expect(remoteChannelPath(USER_ID, 'host')).toBe(`/v1/u/${USER_ID}/host`);
    expect(parseRemoteChannelPath(`/v1/u/${USER_ID}/host`)).toEqual({
      userId: USER_ID,
      route: 'host',
    });
    expect(parseRemoteChannelPath(`/v1/u/${USER_ID}/connect`)).toEqual({
      userId: USER_ID,
      route: 'connect',
    });
  });

  it('rejects malformed channel paths without treating them as legacy', () => {
    for (const path of [
      `/v1/u/${USER_ID}`,
      `/v1/u/${USER_ID}/`,
      `/v1/u/${USER_ID}/connect/extra`,
      `/v1/u/${USER_ID}/other`,
      '/v1/u/short/connect',
      `/v1/u/../${USER_ID}/connect`,
    ]) {
      expect(parseRemoteChannelPath(path)).toBeUndefined();
      expect(isRemoteChannelPathname(path)).toBe(true);
    }
    expect(parseRemoteChannelPath('/')).toBeUndefined();
    expect(isRemoteChannelPathname('/')).toBe(false);
  });

  it('refuses to build a path for an invalid user id', () => {
    expect(() => remoteChannelPath('nope', 'connect')).toThrow();
  });
});

describe('decodeRelayControlFrame', () => {
  it('decodes every known frame', () => {
    expect(decodeRelayControlFrame('{"t":"challenge","nonce":"abc"}')).toEqual({
      t: 'challenge',
      nonce: 'abc',
    });
    expect(
      decodeRelayControlFrame(
        '{"t":"auth","hostPub":"h","userPub":"u","hostSig":"hs","userSig":"us","enrollToken":"e"}',
      ),
    ).toEqual({
      t: 'auth',
      hostPub: 'h',
      userPub: 'u',
      hostSig: 'hs',
      userSig: 'us',
      enrollToken: 'e',
    });
    expect(decodeRelayControlFrame('{"t":"ready"}')).toEqual({ t: 'ready' });
    expect(decodeRelayControlFrame('{"t":"host-replaced"}')).toEqual({ t: 'host-replaced' });
    expect(decodeRelayControlFrame('{"t":"peer-joined","peer":7}')).toEqual({
      t: 'peer-joined',
      peer: 7,
    });
    expect(decodeRelayControlFrame('{"t":"peer-left","peer":4294967295}')).toEqual({
      t: 'peer-left',
      peer: 4294967295,
    });
  });

  it('drops extra fields instead of passing them through', () => {
    expect(decodeRelayControlFrame('{"t":"ready","injected":true}')).toEqual({ t: 'ready' });
  });

  it('rejects malformed frames', () => {
    for (const text of [
      'not json',
      'null',
      '[]',
      '{"t":"unknown"}',
      '{"t":"challenge"}',
      '{"t":"challenge","nonce":""}',
      `{"t":"challenge","nonce":"${'x'.repeat(513)}"}`,
      '{"t":"auth","hostPub":"h","userPub":"u","hostSig":"hs"}',
      '{"t":"auth","hostPub":"h","userPub":"u","hostSig":"hs","userSig":"us","enrollToken":7}',
      '{"t":"peer-joined","peer":0}',
      '{"t":"peer-joined","peer":1.5}',
      '{"t":"peer-joined","peer":4294967296}',
      '{"t":"peer-left","peer":"1"}',
    ]) {
      expect(decodeRelayControlFrame(text)).toBeUndefined();
    }
  });
});
