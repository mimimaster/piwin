import { describe, expect, it } from 'vitest';
import { stampSubscriptionAuthCommand } from './stamp-subscription-auth.js';

describe('stampSubscriptionAuthCommand', () => {
  it('overwrites login owner and keeps browser loopback preference', () => {
    const stamped = stampSubscriptionAuthCommand(
      {
        type: 'auth/login',
        input: {
          providerId: 'openai-codex',
          ownerDeviceId: 'spoofed',
          preferLoopback: true,
        },
      },
      { devicePrincipalId: 'device-1' },
    );
    expect(stamped).toEqual({
      type: 'auth/login',
      input: {
        providerId: 'openai-codex',
        ownerDeviceId: 'device-1',
        preferLoopback: true,
      },
    });
  });

  it('stamps respond and cancel owners', () => {
    expect(
      stampSubscriptionAuthCommand(
        {
          type: 'auth/respond',
          input: { loginId: 'l1', promptId: 'p1', value: 'code' },
        },
        { devicePrincipalId: 'device-1' },
      ),
    ).toEqual({
      type: 'auth/respond',
      input: { loginId: 'l1', promptId: 'p1', value: 'code', ownerDeviceId: 'device-1' },
    });
    expect(
      stampSubscriptionAuthCommand(
        { type: 'auth/cancel', loginId: 'l1' },
        { devicePrincipalId: 'device-1' },
      ),
    ).toEqual({ type: 'auth/cancel', loginId: 'l1', ownerDeviceId: 'device-1' });
  });
});
