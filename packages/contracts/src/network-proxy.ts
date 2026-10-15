/**
 * Host outbound proxy setting (ADR 0091).
 *
 * Mirrors Pi's `httpProxy` setting and CLIProxyAPI's `proxy-url`: the proxy is
 * an explicit choice in `~/.piwin/config.json`, never read from the OS behind
 * the user's back. The OS proxy is only *detected* on request so a settings UI
 * can offer it as a one-click fill.
 */

export type NetworkConfig = {
  /**
   * Omitted or empty: inherit `HTTP(S)_PROXY` from the Host's launch
   * environment. `direct`: ignore every proxy variable. Otherwise an
   * `http://` or `https://` proxy URL used for all Host outbound requests.
   */
  proxyUrl?: string;
};

/** Value of {@link NetworkConfig.proxyUrl} that forces direct connections. */
export const NETWORK_PROXY_DIRECT = 'direct';

export type NetworkProxySetting =
  | { mode: 'inherit' }
  | { mode: 'direct' }
  | { mode: 'proxy'; url: string }
  | { mode: 'invalid'; reason: string };

/**
 * Interpret a configured proxy value. `none` is accepted as an alias for
 * `direct` (CLIProxyAPI spelling). SOCKS and PAC are rejected because the
 * Host's fetch (undici) only speaks HTTP CONNECT.
 */
export function parseNetworkProxySetting(raw: string | undefined): NetworkProxySetting {
  const trimmed = raw?.trim() ?? '';
  if (trimmed.length === 0) return { mode: 'inherit' };
  const lowered = trimmed.toLowerCase();
  if (lowered === NETWORK_PROXY_DIRECT || lowered === 'none') return { mode: 'direct' };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { mode: 'invalid', reason: 'proxyUrl is not a valid URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      mode: 'invalid',
      reason: `proxyUrl must use http:// or https:// (got ${parsed.protocol}); SOCKS and PAC are not supported`,
    };
  }
  if (parsed.hostname.length === 0) {
    return { mode: 'invalid', reason: 'proxyUrl is missing a host' };
  }
  return { mode: 'proxy', url: trimmed };
}

/** Keep the trimmed value; validation (not normalization) rejects bad URLs so a save never drops them silently. */
export function normalizeNetworkConfig(value: unknown): NetworkConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const proxyUrl = (value as Record<string, unknown>).proxyUrl;
  if (typeof proxyUrl !== 'string' || proxyUrl.trim().length === 0) return undefined;
  return { proxyUrl: proxyUrl.trim() };
}

export type NetworkConfigIssue = { path: string; message: string };

export function validateNetworkConfig(config: NetworkConfig | undefined): NetworkConfigIssue[] {
  const setting = parseNetworkProxySetting(config?.proxyUrl);
  return setting.mode === 'invalid' ? [{ path: 'network.proxyUrl', message: setting.reason }] : [];
}

/** Response of `network/detect-system-proxy`. */
export type SystemProxyDetection = {
  /** False on platforms the Host cannot read (only macOS today). */
  supported: boolean;
  /** HTTPS proxy when set, else the HTTP proxy; absent when the OS has none. */
  proxyUrl?: string;
  /** Why reading the OS proxy failed. */
  error?: string;
};
