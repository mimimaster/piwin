import { describe, expect, it } from 'vitest';
import { createNativeLiveAudioBridge } from './native-live-audio.js';

describe('native Live audio boundary', () => {
  it('isolates connections and strips unknown native fields', async () => {
    const bridge = createNativeLiveAudioBridge(async () => [
      { connectionId: 'current', type: 'message', message: '{"type":"session.updated"}', token: 'private' },
      { connectionId: 'old', type: 'failed' }, { connectionId: 'current', type: 'execute' }, null,
    ]);
    expect(await bridge.takeEvents('current')).toEqual([
      { connectionId: 'current', type: 'message', message: '{"type":"session.updated"}' },
    ]);
  });
  it('maps native microphone refusal to the existing permission error', async () => {
    const bridge = createNativeLiveAudioBridge(async () => { throw { message: 'mic-denied' }; });
    await expect(bridge.prepare('current')).rejects.toMatchObject({ name: 'NotAllowedError' });
  });
});
