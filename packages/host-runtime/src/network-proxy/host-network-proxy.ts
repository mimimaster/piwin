import { execFileSync } from 'node:child_process';
import { installEnvHttpProxyDispatcher } from '@piwin/agent-host';
import { formatError, pickChildProxyEnv } from '@piwin/contracts';
import { parseScutilProxyOutput } from './macos-system-proxy.js';

/**
 * Resolve the Host's outbound proxy once at startup and make every network
 * path use it: global fetch (OAuth, Pi providers, web tools), agent workers,
 * and child processes that inherit the environment.
 *
 * Order: explicit proxy variables win; otherwise the macOS system proxy;
 * `PIWIN_SYSTEM_PROXY=0` opts out of the system lookup. A system proxy changed
 * later takes effect after the Host restarts.
 */
export type HostNetworkProxySource = 'env' | 'system' | 'none';

export type HostNetworkProxyResolution = {
  source: HostNetworkProxySource;
  /** Variables to add to the Host environment (empty unless source is `system`). */
  assign: Record<string, string>;
  /** Why the system lookup failed, when it ran and failed. */
  systemError?: string;
};

export type ResolveHostNetworkProxyInput = {
  env: Readonly<Record<string, string | undefined>>;
  platform: string;
  readSystemProxy: () => string;
};

/** Loopback must never go through the proxy (local Host, OAuth callbacks, dev servers). */
const ALWAYS_DIRECT = ['localhost', '127.0.0.1', '::1'];

export function resolveHostNetworkProxy(
  input: ResolveHostNetworkProxyInput,
): HostNetworkProxyResolution {
  const proxyEnv = pickChildProxyEnv(input.env);
  const hasProxy = Object.keys(proxyEnv).some((key) => !/^no_proxy$/iu.test(key));
  if (hasProxy) return { source: 'env', assign: {} };
  if (input.platform !== 'darwin' || input.env.PIWIN_SYSTEM_PROXY === '0') {
    return { source: 'none', assign: {} };
  }
  let output: string;
  try {
    output = input.readSystemProxy();
  } catch (error) {
    return { source: 'none', assign: {}, systemError: formatError(error) };
  }
  const settings = parseScutilProxyOutput(output);
  if (!settings.httpProxy && !settings.httpsProxy) return { source: 'none', assign: {} };
  const assign: Record<string, string> = {};
  if (settings.httpProxy) assign.HTTP_PROXY = settings.httpProxy;
  if (settings.httpsProxy) assign.HTTPS_PROXY = settings.httpsProxy;
  const existingNoProxy = input.env.NO_PROXY ?? input.env.no_proxy;
  if (existingNoProxy === undefined || existingNoProxy.trim().length === 0) {
    assign.NO_PROXY = [...new Set([...ALWAYS_DIRECT, ...settings.exceptions])].join(',');
  }
  return { source: 'system', assign };
}

function readMacosSystemProxy(): string {
  return execFileSync('/usr/sbin/scutil', ['--proxy'], { encoding: 'utf8', timeout: 2_000 });
}

/** Apply {@link resolveHostNetworkProxy} to this process. Returns one log line. */
export function applyHostNetworkProxy(): string {
  const resolution = resolveHostNetworkProxy({
    env: process.env,
    platform: process.platform,
    readSystemProxy: readMacosSystemProxy,
  });
  Object.assign(process.env, resolution.assign);
  const installed = installEnvHttpProxyDispatcher();
  return describeHostNetworkProxy(resolution, installed, process.env);
}

export function describeHostNetworkProxy(
  resolution: HostNetworkProxyResolution,
  dispatcherInstalled: boolean,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const https = env.HTTPS_PROXY ?? env.https_proxy;
  const http = env.HTTP_PROXY ?? env.http_proxy;
  const parts = [`network proxy source=${resolution.source}`];
  if (https) parts.push(`https=${redactProxyUrl(https)}`);
  if (http && http !== https) parts.push(`http=${redactProxyUrl(http)}`);
  parts.push(`fetch=${dispatcherInstalled ? 'proxied' : 'direct'}`);
  if (resolution.systemError) parts.push(`systemError=${resolution.systemError}`);
  return parts.join(' ');
}

/** Proxy URLs may embed credentials; logs keep only scheme, host and port. */
export function redactProxyUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    return '<invalid proxy url>';
  }
}
