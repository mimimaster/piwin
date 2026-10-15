/**
 * Parse `scutil --proxy` (macOS SystemConfiguration proxy dictionary).
 *
 * GUI-launched Hosts (the Desktop sidecar) inherit no shell proxy variables,
 * so the system proxy is the only signal that the user's network needs one.
 * PAC and SOCKS-only setups are not translated: undici's env proxy agent only
 * speaks HTTP CONNECT proxies.
 */
export type SystemProxySettings = {
  httpProxy?: string;
  httpsProxy?: string;
  /** macOS bypass list, normalized to `NO_PROXY` entries. */
  exceptions: string[];
};

const ENTRY = /^\s*([A-Za-z]+)\s*:\s*(.*?)\s*$/;
const ARRAY_ITEM = /^\s*\d+\s*:\s*(.*?)\s*$/;

export function parseScutilProxyOutput(output: string): SystemProxySettings {
  const scalars = new Map<string, string>();
  const exceptions: string[] = [];
  let inExceptions = false;
  for (const line of output.split(/\r?\n/u)) {
    if (inExceptions) {
      if (line.trim() === '}') {
        inExceptions = false;
        continue;
      }
      const item = ARRAY_ITEM.exec(line)?.[1];
      if (item) exceptions.push(normalizeException(item));
      continue;
    }
    const entry = ENTRY.exec(line);
    if (!entry) continue;
    const [, key = '', value = ''] = entry;
    if (key === 'ExceptionsList' && value.startsWith('<array>')) {
      inExceptions = true;
      continue;
    }
    scalars.set(key, value);
  }
  const settings: SystemProxySettings = { exceptions };
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

/** `*.example.com` → `.example.com`, the suffix form every NO_PROXY reader accepts. */
function normalizeException(entry: string): string {
  return entry.startsWith('*.') ? entry.slice(1) : entry;
}
