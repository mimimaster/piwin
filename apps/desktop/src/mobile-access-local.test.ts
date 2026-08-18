// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MOBILE_ACCESS_ADVERTISED_ENDPOINT,
  loadMobileAccessAdvertisedEndpoint,
  saveMobileAccessAdvertisedEndpoint,
} from './mobile-access-local';

describe('mobile-access advertised endpoint preference', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to loopback and round-trips a Tailscale URL', () => {
    expect(loadMobileAccessAdvertisedEndpoint()).toBe(DEFAULT_MOBILE_ACCESS_ADVERTISED_ENDPOINT);
    saveMobileAccessAdvertisedEndpoint('wss://mac.tailnet.ts.net:8787');
    expect(loadMobileAccessAdvertisedEndpoint()).toBe('wss://mac.tailnet.ts.net:8787');
    saveMobileAccessAdvertisedEndpoint('  ');
    expect(loadMobileAccessAdvertisedEndpoint()).toBe(DEFAULT_MOBILE_ACCESS_ADVERTISED_ENDPOINT);
  });
});
