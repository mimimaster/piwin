import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_BRIDGE_READY_TYPE,
  ARTIFACT_BRIDGE_RESIZE_TYPE,
} from './constants.js';
import {
  isArtifactBridgeReadyMessage,
  parseArtifactBridgeMessage,
} from './bridge-protocol.js';

describe('parseArtifactBridgeMessage', () => {
  it('accepts a valid ready message', () => {
    const message = parseArtifactBridgeMessage({
      type: ARTIFACT_BRIDGE_READY_TYPE,
      channelId: 'ch-1',
      height: 420.7,
    });
    expect(message).toEqual({
      type: ARTIFACT_BRIDGE_READY_TYPE,
      channelId: 'ch-1',
      height: 421,
      mode: 'normal',
    });
    expect(message && isArtifactBridgeReadyMessage(message)).toBe(true);
  });

  it('accepts resize with interaction mode', () => {
    const message = parseArtifactBridgeMessage({
      type: ARTIFACT_BRIDGE_RESIZE_TYPE,
      channelId: 'ch-2',
      height: 300,
      mode: 'interaction',
    });
    expect(message).toEqual({
      type: ARTIFACT_BRIDGE_RESIZE_TYPE,
      channelId: 'ch-2',
      height: 300,
      mode: 'interaction',
    });
  });

  it('rejects wrong type, missing channel, and NaN height', () => {
    expect(parseArtifactBridgeMessage({ type: 'other', channelId: 'x', height: 1 })).toBeNull();
    expect(
      parseArtifactBridgeMessage({ type: ARTIFACT_BRIDGE_READY_TYPE, height: 10 }),
    ).toBeNull();
    expect(
      parseArtifactBridgeMessage({
        type: ARTIFACT_BRIDGE_READY_TYPE,
        channelId: 'ch',
        height: Number.NaN,
      }),
    ).toBeNull();
    expect(
      parseArtifactBridgeMessage({
        type: ARTIFACT_BRIDGE_RESIZE_TYPE,
        channelId: 'ch',
        height: 10,
        mode: 'bogus',
      }),
    ).toBeNull();
  });
});
