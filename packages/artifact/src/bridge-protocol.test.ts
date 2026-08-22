import { describe, expect, it } from 'vitest';
import { ARTIFACT_BRIDGE_SIZE_TYPE } from './constants.js';
import { parseArtifactBridgeMessage } from './bridge-protocol.js';

describe('parseArtifactBridgeMessage', () => {
  it('accepts and normalizes a valid revisioned size message', () => {
    const message = parseArtifactBridgeMessage({
      type: ARTIFACT_BRIDGE_SIZE_TYPE,
      channelId: 'ch-1',
      height: 420.7,
      viewportHeight: 80.2,
      revision: 3,
    });
    expect(message).toEqual({
      type: ARTIFACT_BRIDGE_SIZE_TYPE,
      channelId: 'ch-1',
      height: 421,
      viewportHeight: 81,
      revision: 3,
    });
  });

  it('rejects legacy, incomplete, and non-finite messages', () => {
    expect(
      parseArtifactBridgeMessage({
        type: 'piwin-artifact:resize',
        channelId: 'ch',
        height: 300,
        viewportHeight: 80,
        revision: 1,
      }),
    ).toBeNull();
    expect(
      parseArtifactBridgeMessage({
        type: ARTIFACT_BRIDGE_SIZE_TYPE,
        channelId: 'ch',
        height: 300,
        revision: 1,
      }),
    ).toBeNull();
    expect(
      parseArtifactBridgeMessage({
        type: ARTIFACT_BRIDGE_SIZE_TYPE,
        channelId: 'ch',
        height: Number.NaN,
        viewportHeight: 80,
        revision: 1,
      }),
    ).toBeNull();
    expect(
      parseArtifactBridgeMessage({
        type: ARTIFACT_BRIDGE_SIZE_TYPE,
        channelId: 'ch',
        height: 300,
        viewportHeight: 80,
        revision: -1,
      }),
    ).toBeNull();
    expect(
      parseArtifactBridgeMessage({
        type: ARTIFACT_BRIDGE_SIZE_TYPE,
        channelId: 'x'.repeat(201),
        height: 300,
        viewportHeight: 80,
        revision: 1,
      }),
    ).toBeNull();
  });
});
