import { describe, expect, it } from 'vitest';
import { decideLiveStart } from './live-start-gate.js';

const request = {
  idempotencyKey: 'k1',
  ownerDeviceId: 'd1',
  sessionId: 's1',
  providerId: 'openai-codex',
};

const bootstrap = { mediaDriverId: 'codex-webrtc-v1' as const, answerSdp: 'v=0\r\n' };

describe('decideLiveStart', () => {
  it('replays the same owner, key, and target when bootstrap exists', () => {
    expect(
      decideLiveStart({
        slot: { ...request, ownerBootstrap: bootstrap },
        startInFlight: null,
        request,
      }),
    ).toEqual({ kind: 'replay', bootstrap });
  });

  it('rejects the same key aimed at a different session', () => {
    expect(
      decideLiveStart({
        slot: { ...request, ownerBootstrap: bootstrap },
        startInFlight: null,
        request: { ...request, sessionId: 's2' },
      }),
    ).toEqual({ kind: 'reject', errorCode: 'live-conflict' });
  });

  it('rejects another owner while a call is up', () => {
    expect(
      decideLiveStart({
        slot: { ...request, ownerBootstrap: bootstrap },
        startInFlight: null,
        request: { ...request, idempotencyKey: 'k2', ownerDeviceId: 'd2' },
      }),
    ).toEqual({ kind: 'reject', errorCode: 'live-call-busy' });
  });

  it('joins an in-flight start for the same owner and key', () => {
    expect(
      decideLiveStart({
        slot: null,
        startInFlight: request,
        request,
      }),
    ).toEqual({ kind: 'join-inflight' });
  });

  it('proceeds when idle', () => {
    expect(decideLiveStart({ slot: null, startInFlight: null, request })).toEqual({
      kind: 'proceed',
    });
  });
});
