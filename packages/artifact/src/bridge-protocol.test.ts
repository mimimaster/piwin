import { describe, expect, it } from 'vitest';
import { ARTIFACT_BRIDGE_SIZE_TYPE, ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE } from './constants.js';
import { parseArtifactBridgeMessage, parseArtifactRenderSnapshot } from './bridge-protocol.js';

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

describe('parseArtifactRenderSnapshot', () => {
  const valid = {
    type: ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE,
    channelId: 'ch-1',
    revision: 2,
    source: '<div>Hello</div>',
    frameMode: 'inline-flow' as const,
    final: false,
  };

  it('accepts a complete snapshot', () => {
    expect(parseArtifactRenderSnapshot(valid)).toEqual(valid);
  });

  it('rejects missing enums, non-boolean final, and oversized source', () => {
    expect(parseArtifactRenderSnapshot({ ...valid, frameMode: 'popup' })).toBeNull();
    expect(parseArtifactRenderSnapshot({ ...valid, final: 1 })).toBeNull();
    expect(parseArtifactRenderSnapshot({ ...valid, revision: -1 })).toBeNull();
    expect(
      parseArtifactRenderSnapshot({
        ...valid,
        source: 'x'.repeat(200_000),
      }),
    ).toBeNull();
    expect(
      parseArtifactRenderSnapshot({
        type: ARTIFACT_BRIDGE_SIZE_TYPE,
        channelId: 'ch-1',
        revision: 0,
        source: '<div/>',
        frameMode: 'inline-flow',
        final: false,
      }),
    ).toBeNull();
  });
});
