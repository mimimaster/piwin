import { describe, expect, it } from 'vitest';
import { ARTIFACT_BRIDGE_MEASURE_REQUEST_TYPE } from './constants.js';
import { createMeasuredRoot, runBridgeSession } from './srcdoc-bridge-test-harness.js';

describe('sandbox height delivery recovery', () => {
  it.each(['webkit', 'messageHandlers', 'piwinArtifact', 'postMessage'] as const)(
    'keeps browser delivery when native %s throws', (nativeFailure) => {
      const session = runBridgeSession(createMeasuredRoot(3557), { nativeFailure });
      expect(session.messages.at(-1)).toMatchObject({ height: 3557, revision: 0 });
    },
  );

  it('confirms loaded content while animation frames are suspended', () => {
    const session = runBridgeSession(createMeasuredRoot(3557), {
      suspendAnimationFrames: true,
    });
    expect(session.messages).toHaveLength(0);
    session.flushTimeouts();
    expect(session.messages.at(-1)).toMatchObject({ height: 3557, revision: 0 });
  });

  it('answers explicit remeasurement without waiting for an animation frame', () => {
    const content = createMeasuredRoot(3557);
    const session = runBridgeSession(content, { suspendAnimationFrames: true });
    const request = {
      type: ARTIFACT_BRIDGE_MEASURE_REQUEST_TYPE,
      channelId: 'test-channel',
      fallbackViewport: true,
      force: true,
      epoch: 7,
    };
    session.dispatchRenderCommand(request);
    expect(session.messages.at(-1)).toMatchObject({ height: 3557, epoch: 7 });
    content.height = 4200;
    session.dispatchRenderCommand(request);
    expect(session.messages.at(-1)).toMatchObject({ height: 4200, epoch: 7 });
  });
});
