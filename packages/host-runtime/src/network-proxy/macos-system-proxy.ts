import { execFileSync } from 'node:child_process';
import { formatError, type SystemProxyDetection } from '@piwin/contracts';

/**
 * Read the macOS system proxy for the settings "use system proxy" fill.
 *
 * Detection only: the Host never applies the result by itself (ADR 0091). PAC
 * and SOCKS-only setups report no proxy, since the Host's fetch (undici) only
 * speaks HTTP CONNECT.
 */
export type SystemProxySettings = {
  httpProxy?: string;
  httpsProxy?: string;
};

const ENTRY = /^\s*([A-Za-z]+)\s*:\s*(.*?)\s*$/;

/** Parse `scutil --proxy` (macOS SystemConfiguration proxy dictionary). */
export function parseScutilProxyOutput(output: string): SystemProxySettings {
  const scalars = new Map<string, string>();
  for (const line of output.split(/\r?\n/u)) {
    const entry = ENTRY.exec(line);
    if (!entry) continue;
    const [, key = '', value = ''] = entry;
    scalars.set(key, value);
  }
  const settings: SystemProxySettings = {};
  const httpProxy = proxyUrl(scalars, 'HTTP');
  if (httpProxy) settings.httpProxy = httpProxy;
  const httpsProxy = proxyUrl(scalars, 'HTTPS');
  if (httpsProxy) settings.httpsProxy = httpsProxy;
  return settings;
}

function proxyUrl(scalars: ReadonlyMap<string, string>, prefix: 'HTTP' | 'HTTPS'): string | undefined {
  if (scalars.get(`${prefix}Enable`) !== '1') return undefined;
  const host = scalars.get(`${prefix}Proxy`)?.trim();
  const port = Number(scalars.get(`${prefix}Port`));
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65_535) return undefined;
  // macOS "Secure Web Proxy" is still a plain HTTP proxy that tunnels HTTPS.
  const hostPart = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `http://${hostPart}:${port}`;
}

export function detectSystemProxy(
  platform: string,
  readSystemProxy: () => string,
): SystemProxyDetection {
  if (platform !== 'darwin') return { supported: false };
  let output: string;
  try {
    output = readSystemProxy();
  } catch (error) {
    return { supported: true, error: formatError(error) };
  }
  const settings = parseScutilProxyOutput(output);
  const proxyUrl = settings.httpsProxy ?? settings.httpProxy;
  return proxyUrl === undefined ? { supported: true } : { supported: true, proxyUrl };
}

export function readMacosSystemProxy(): string {
  return execFileSync('/usr/sbin/scutil', ['--proxy'], { encoding: 'utf8', timeout: 2_000 });
}
