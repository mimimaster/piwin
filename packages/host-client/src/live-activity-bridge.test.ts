import { describe, expect, it, vi } from 'vitest';
import { createLiveActivityBridge } from './live-activity-bridge.js';

describe('native Live Activity bridge', () => {
  it('checks system authorization and consumes only supported controls', async () => {
    const invoke = vi.fn(async (command: string): Promise<unknown> =>
      command.endsWith('status') ? { enabled: true } : [
        { callId: 'call-1', action: 'toggle-muted' },
        { callId: 'call-1', action: 'execute-tool' },
      ]);
    const bridge = createLiveActivityBridge(invoke);
    expect(await bridge.isAvailable()).toBe(true);
    expect(await bridge.takeControls()).toEqual([{ callId: 'call-1', action: 'toggle-muted' }]);
    await bridge.sync(null);
    expect(invoke).toHaveBeenCalledWith('plugin:piwin-live|live_activity_sync', { activity: null });
  });
});
