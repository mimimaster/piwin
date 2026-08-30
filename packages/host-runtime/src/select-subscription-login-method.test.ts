import { describe, expect, it } from 'vitest';
import { selectSubscriptionLoginMethod } from './select-subscription-login-method.js';

describe('selectSubscriptionLoginMethod', () => {
  it('picks browser over headless device_code', () => {
    expect(
      selectSubscriptionLoginMethod([
        { id: 'browser' },
        { id: 'device_code' },
      ]),
    ).toBe('browser');
  });

  it('does not invent a method for device-only providers', () => {
    expect(selectSubscriptionLoginMethod([{ id: 'device_code' }])).toBeUndefined();
    expect(selectSubscriptionLoginMethod(undefined)).toBeUndefined();
  });
});
