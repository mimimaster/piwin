/**
 * One GET that follows the proxy already configured for this process or OS.
 * No proxy (the common case) stays a direct global fetch. Never invents a port.
 *
 * Unit tests stub global fetch and run on machines that may have a real system
 * proxy, so they stay direct unless PIWIN_CATALOG_USE_SYSTEM_PROXY=1.
 */
import http from 'node:http';
import https from 'node:https';
import { execFile } from 'node:child_process';

export type ProxyFetch = (url: string, init: { signal: AbortSignal }) => Promise<ProxyFetchResponse>;

export type ProxyFetchResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
};

type ProxyEndpoint = { protocol: 'http:' | 'https:'; hostname: string; port: number };

export async function fetchCatalogGet(
  url: string,
  init: { signal: AbortSignal },
  platform: NodeJS.Platform = process.platform,
): Promise<ProxyFetchResponse> {
  const proxy = await resolveProxy(platform);
  if (!proxy) {
    return direct(url, init.signal);
  }
  return requestViaProxy(url, proxy, init.signal);
}

async function direct(url: string, signal: AbortSignal): Promise<ProxyFetchResponse> {
  const response = await globalThis.fetch(url, {
    method: 'GET',
    signal,
    headers: { accept: 'application/json' },
  });
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    json: () => response.json() as Promise<unknown>,
  };
}

async function resolveProxy(platform: NodeJS.Platform): Promise<ProxyEndpoint | undefined> {
  if (process.env.NODE_ENV === 'test' && process.env.PIWIN_CATALOG_USE_SYSTEM_PROXY !== '1') {
    return undefined;
  }
  return proxyFromEnv() ?? (await readSystemProxy(platform));
}

function proxyFromEnv(): ProxyEndpoint | undefined {
  const raw = firstEnv('https_proxy', 'HTTPS_PROXY', 'http_proxy', 'HTTP_PROXY', 'all_proxy', 'ALL_PROXY');
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
    if (!parsed.hostname || !Number.isInteger(port)) return undefined;
    return { protocol: parsed.protocol, hostname: parsed.hostname, port };
  } catch {
    return undefined;
  }
}

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

async function readSystemProxy(platform: NodeJS.Platform): Promise<ProxyEndpoint | undefined> {
  if (platform === 'darwin') return readDarwinProxy();
  if (platform === 'win32') return readWindowsProxy();
  return undefined;
}

function readDarwinProxy(): Promise<ProxyEndpoint | undefined> {
  return new Promise((resolve) => {
    execFile('scutil', ['--proxy'], { timeout: 2_000 }, (error, stdout) => {
      if (error) {
        resolve(undefined);
        return;
      }
      resolve(parseScutilProxy(stdout));
    });
  });
}

export function parseScutilProxy(text: string): ProxyEndpoint | undefined {
  const httpsOn = /HTTPSEnable\s*:\s*1\b/.test(text);
  const httpOn = /HTTPEnable\s*:\s*1\b/.test(text);
  if (!httpsOn && !httpOn) return undefined;
  const prefix = httpsOn ? 'HTTPS' : 'HTTP';
  const host = text.match(new RegExp(`${prefix}Proxy\\s*:\\s*(\\S+)`))?.[1];
  const port = Number(text.match(new RegExp(`${prefix}Port\\s*:\\s*(\\d+)`))?.[1]);
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return undefined;
  return { protocol: 'http:', hostname: host, port };
}

function readWindowsProxy(): Promise<ProxyEndpoint | undefined> {
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],
      { timeout: 2_000, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(undefined);
          return;
        }
        resolve(parseWindowsProxyQuery(stdout));
      },
    );
  });
}

export function parseWindowsProxyQuery(text: string): ProxyEndpoint | undefined {
  if (!/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(text)) return undefined;
  const server = text.match(/ProxyServer\s+REG_SZ\s+(\S+)/)?.[1];
  return server ? parseWindowsProxyServer(server) : undefined;
}

export function parseWindowsProxyServer(value: string): ProxyEndpoint | undefined {
  const raw = value.trim();
  if (!raw || raw === '-') return undefined;
  const selected = raw.includes('=')
    ? (raw.split(';').find((part) => part.startsWith('https=')) ??
      raw.split(';').find((part) => part.startsWith('http=')))
    : raw;
  if (!selected) return undefined;
  const withoutScheme = selected.replace(/^(?:https|http)=/, '');
  const [host, portText] = withoutScheme.split(':');
  const port = Number(portText);
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return undefined;
  return { protocol: 'http:', hostname: host, port };
}

function requestViaProxy(
  targetUrl: string,
  proxy: ProxyEndpoint,
  signal: AbortSignal,
): Promise<ProxyFetchResponse> {
  const target = new URL(targetUrl);
  const transport = proxy.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    const request = transport.request({
      protocol: proxy.protocol,
      hostname: proxy.hostname,
      port: proxy.port,
      method: 'GET',
      path: targetUrl,
      headers: { Host: target.host, Accept: 'application/json' },
    });
    const onAbort = (): void => {
      request.destroy(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    request.once('error', (error) => {
      signal.removeEventListener('abort', onAbort);
      reject(error);
    });
    request.once('response', (response) => {
      signal.removeEventListener('abort', onAbort);
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.once('error', reject);
      response.once('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const status = response.statusCode ?? 0;
        resolve({
          ok: status >= 200 && status < 300,
          status,
          statusText: response.statusMessage ?? '',
          json: async () => JSON.parse(body) as unknown,
        });
      });
    });
    request.end();
  });
}
