const ADVERTISED_ENDPOINT_KEY = 'piwin.desktop.mobile-access.advertisedEndpoint';
export const DEFAULT_MOBILE_ACCESS_ADVERTISED_ENDPOINT = 'ws://127.0.0.1:8787';
export const MOBILE_ACCESS_SIDECAR_ONLY_ERROR = 'Phone access is only available on this Mac’s sidecar';

export function loadMobileAccessAdvertisedEndpoint(): string {
  if (typeof localStorage === 'undefined') {
    return DEFAULT_MOBILE_ACCESS_ADVERTISED_ENDPOINT;
  }
  const stored = localStorage.getItem(ADVERTISED_ENDPOINT_KEY)?.trim();
  return stored !== undefined && stored.length > 0 ? stored : DEFAULT_MOBILE_ACCESS_ADVERTISED_ENDPOINT;
}

export function saveMobileAccessAdvertisedEndpoint(endpoint: string): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  const trimmed = endpoint.trim();
  if (trimmed.length === 0) {
    localStorage.removeItem(ADVERTISED_ENDPOINT_KEY);
    return;
  }
  localStorage.setItem(ADVERTISED_ENDPOINT_KEY, trimmed);
}
