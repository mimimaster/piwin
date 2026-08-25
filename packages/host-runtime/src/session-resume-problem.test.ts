import { describe, expect, it } from 'vitest';
import { HostRuntime } from './host-runtime.js';

describe('session/resume problem details', () => {
  it('returns a stable problem code when the session is missing', async () => {
    const runtime = new HostRuntime({ mode: 'sdk', mock: true });

    const response = await runtime.handleCommand({
      type: 'session/resume',
      sessionId: 'missing-session',
    });

    expect(response).toMatchObject({
      success: false,
      problem: { code: 'session-not-found' },
    });
    await runtime.dispose();
  });
});
