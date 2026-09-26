import { mobileLocalStorage } from './mobile-local-storage.js';

export const MOBILE_LAST_HOST_ENDPOINT_KEY = 'piwin.mobile.last-endpoint.v1';

/**
 * The last Host endpoint this device completed a handshake with, so a cold
 * launch redials it instead of the build-time default. The address is not a
 * secret; the matching device credential lives in the Keychain vault, keyed by
 * this same endpoint.
 */
export function readLastMobileHostEndpoint(
  storage: Pick<Storage, 'getItem'> | undefined = mobileLocalStorage(),
): string | undefined {
  try {
    const raw = storage?.getItem(MOBILE_LAST_HOST_ENDPOINT_KEY)?.trim();
    return raw === undefined || !isWebSocketEndpoint(raw) ? undefined : raw;
  } catch {
    return undefined;
  }
}

export function writeLastMobileHostEndpoint(
  endpoint: string,
  storage: Pick<Storage, 'setItem'> | undefined = mobileLocalStorage(),
): void {
  try {
    storage?.setItem(MOBILE_LAST_HOST_ENDPOINT_KEY, endpoint.trim());
  } catch (error) {
    // Losing the remembered address only costs a manual re-entry on next launch.
    console.warn('[piwin-mobile] failed to remember Host endpoint', error);
  }
}

export function clearLastMobileHostEndpoint(
  storage: Pick<Storage, 'removeItem'> | undefined = mobileLocalStorage(),
): void {
  try {
    storage?.removeItem(MOBILE_LAST_HOST_ENDPOINT_KEY);
  } catch (error) {
    console.warn('[piwin-mobile] failed to forget Host endpoint', error);
  }
}

function isWebSocketEndpoint(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}
