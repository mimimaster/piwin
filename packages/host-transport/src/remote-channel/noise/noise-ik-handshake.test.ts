import { describe, expect, it } from 'vitest';
import { RemoteChannelError } from '../remote-channel-error.js';
import { NoiseChannel } from './noise-channel.js';
import { generateNoiseKeyPair, NoiseIkHandshake, type NoiseKeyPair } from './noise-ik-handshake.js';

const PROLOGUE = new TextEncoder().encode('piwin-channel-v1\0test');

function pair(
  options: {
    initiatorPrologue?: Uint8Array;
    pinnedHostKey?: Uint8Array;
    hostStatic?: NoiseKeyPair;
  } = {},
) {
  const clientStatic = generateNoiseKeyPair();
  const hostStatic = options.hostStatic ?? generateNoiseKeyPair();
  const initiator = NoiseIkHandshake.initiator({
    prologue: options.initiatorPrologue ?? PROLOGUE,
    staticKeyPair: clientStatic,
    remoteStaticPublicKey: options.pinnedHostKey ?? hostStatic.publicKey,
  });
  const responder = NoiseIkHandshake.responder({ prologue: PROLOGUE, staticKeyPair: hostStatic });
  return { clientStatic, hostStatic, initiator, responder };
}

function expectHandshakeFailure(operation: () => unknown): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(RemoteChannelError);
    expect((error as RemoteChannelError).reason).toBe('handshake-failed');
    return;
  }
  throw new Error('expected the handshake to fail');
}

describe('NoiseIkHandshake', () => {
  it('completes with matching transport keys and tells the responder who connected', () => {
    const { clientStatic, initiator, responder } = pair();
    const message1 = initiator.writeMessage();
    expect(responder.readMessage(message1)).toEqual(new Uint8Array(0));
    expect(responder.remoteStaticPublicKey).toEqual(clientStatic.publicKey);
    expect(responder.isComplete).toBe(false);
    initiator.readMessage(responder.writeMessage());
    expect(initiator.isComplete && responder.isComplete).toBe(true);
    expect(initiator.handshakeHash).toEqual(responder.handshakeHash);

    const client = new NoiseChannel(initiator.split());
    const host = new NoiseChannel(responder.split());
    expect(host.decrypt(client.encrypt(Uint8Array.of(1, 2)))).toEqual(Uint8Array.of(1, 2));
    expect(client.decrypt(host.encrypt(Uint8Array.of(3)))).toEqual(Uint8Array.of(3));
  });

  it('message 1 is the fixed 96-byte size without payload', () => {
    expect(pair().initiator.writeMessage()).toHaveLength(32 + 48 + 16);
  });

  it('fails when the client pinned a different Host key (relay impersonation)', () => {
    const { initiator, responder } = pair({ pinnedHostKey: generateNoiseKeyPair().publicKey });
    expectHandshakeFailure(() => responder.readMessage(initiator.writeMessage()));
  });

  it('fails when the prologue differs (handshake replayed under other ids)', () => {
    const { initiator, responder } = pair({ initiatorPrologue: new TextEncoder().encode('other') });
    expectHandshakeFailure(() => responder.readMessage(initiator.writeMessage()));
  });

  it('fails on a tampered message 1 at any position', () => {
    for (const position of [0, 40, 95]) {
      const { initiator, responder } = pair();
      const message1 = initiator.writeMessage();
      message1[position] = (message1[position] ?? 0) ^ 0x01;
      expectHandshakeFailure(() => responder.readMessage(message1));
    }
  });

  it('fails on a tampered message 2', () => {
    const { initiator, responder } = pair();
    responder.readMessage(initiator.writeMessage());
    const message2 = responder.writeMessage();
    message2[message2.length - 1] = (message2[message2.length - 1] ?? 0) ^ 0x80;
    expectHandshakeFailure(() => initiator.readMessage(message2));
  });

  it('fails on truncated messages', () => {
    const first = pair();
    expectHandshakeFailure(() =>
      first.responder.readMessage(first.initiator.writeMessage().subarray(0, 95)),
    );
    const second = pair();
    second.responder.readMessage(second.initiator.writeMessage());
    expectHandshakeFailure(() =>
      second.initiator.readMessage(second.responder.writeMessage().subarray(0, 47)),
    );
  });

  it('rejects a low-order ephemeral key', () => {
    const { initiator, responder } = pair();
    const message1 = initiator.writeMessage();
    message1.fill(0, 0, 32);
    expectHandshakeFailure(() => responder.readMessage(message1));
  });

  it('fails a replayed message 1 against a fresh responder session for a different Host', () => {
    const { initiator } = pair();
    const message1 = initiator.writeMessage();
    const otherHost = NoiseIkHandshake.responder({
      prologue: PROLOGUE,
      staticKeyPair: generateNoiseKeyPair(),
    });
    expectHandshakeFailure(() => otherHost.readMessage(message1));
  });

  it('enforces message order and stays poisoned after a failure', () => {
    const { initiator, responder } = pair();
    expectHandshakeFailure(() => responder.writeMessage());
    expectHandshakeFailure(() => responder.readMessage(initiator.writeMessage()));
    expectHandshakeFailure(() => initiator.writeMessage());
  });

  it('refuses to split before completion', () => {
    expectHandshakeFailure(() => pair().initiator.split());
  });
});
