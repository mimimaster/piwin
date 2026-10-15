import { configureEnvHttpProxyDispatcher } from '@piwin/agent-host';
import {
  CHILD_PROXY_ENV_KEYS,
  formatError,
  parseNetworkProxySetting,
  pickChildProxyEnv,
  type NetworkConfig,
} from '@piwin/contracts';
import { loadPiwinConfig } from '../config-store.js';

/**
 * Apply the Host's `network.proxyUrl` setting (ADR 0091) to this process:
 * proxy variables in `process.env` (read by agent workers and other children
 * at spawn) and the global fetch dispatcher (OAuth, Pi providers, web tools).
 *
 * Same model as Pi's `httpProxy` and CLIProxyAPI's `proxy-url`: the proxy is
 * an explicit setting. Empty inherits the launch environment, `direct` ignores
 * it, a URL overrides it. The OS proxy is never applied implicitly; see
 * `detectSystemProxy` for the opt-in fill.
 */
export type HostNetworkProxySource = 'setting' | 'direct' | 'env' | 'none';

export type HostProxyEnvPlan = {
  source: HostNetworkProxySource;
  /** Complete proxy variable set for the process; keys not listed are removed. */
  env: Record<string, string>;
  /** Set when the stored value is unusable and the launch environment was kept. */
  invalidReason?: string;
};

/** Loopback must never go through the proxy (local Host, OAuth callbacks, dev servers). */
const ALWAYS_DIRECT = 'localhost,127.0.0.1,::1';

export function planHostProxyEnv(
  network: NetworkConfig | undefined,
  launchEnv: Readonly<Record<string, string | undefined>>,
): HostProxyEnvPlan {
  const setting = parseNetworkProxySetting(network?.proxyUrl);
  if (setting.mode === 'direct') {
    return { source: 'direct', env: {} };
  }
  if (setting.mode === 'proxy') {
    const noProxy = launchEnv.NO_PROXY ?? launchEnv.no_proxy;
    const bypass = noProxy !== undefined && noProxy.trim().length > 0 ? noProxy : ALWAYS_DIRECT;
    // Both spellings: curl reads only lowercase `http_proxy`, most tools read either.
    return {
      source: 'setting',
      env: {
        HTTP_PROXY: setting.url,
        HTTPS_PROXY: setting.url,
        NO_PROXY: bypass,
        http_proxy: setting.url,
        https_proxy: setting.url,
        no_proxy: bypass,
      },
    };
  }
  const inherited = pickChildProxyEnv(launchEnv);
  const hasProxy = Object.keys(inherited).some((key) => !/^no_proxy$/iu.test(key));
  const plan: HostProxyEnvPlan = { source: hasProxy ? 'env' : 'none', env: inherited };
  if (setting.mode === 'invalid') plan.invalidReason = setting.reason;
  return plan;
}

/** Proxy variables as the Host was launched, so "inherit" can be restored after an override. */
let launchProxyEnv: Record<string, string> | undefined;

/** Apply `network` to this process. Returns one log line. */
export function applyHostNetworkProxy(network: NetworkConfig | undefined): string {
  launchProxyEnv ??= pickChildProxyEnv(process.env);
  const plan = planHostProxyEnv(network, launchProxyEnv);
  for (const key of CHILD_PROXY_ENV_KEYS) {
    delete process.env[key];
  }
  Object.assign(process.env, plan.env);
  const proxied = configureEnvHttpProxyDispatcher();
  return describeHostNetworkProxy(plan, proxied);
}

/**
 * Startup entry: read `network` from the Host config before any fetch. A config
 * that cannot be read keeps the launch environment; the error goes in the log
 * line rather than stopping the Host over a proxy setting.
 */
export async function applyHostNetworkProxyFromConfig(piwinRoot?: string): Promise<string> {
  try {
    const config = await loadPiwinConfig(piwinRoot);
    return applyHostNetworkProxy(config.network);
  } catch (error) {
    return `${applyHostNetworkProxy(undefined)} configError=${formatError(error)}`;
  }
}

export function describeHostNetworkProxy(plan: HostProxyEnvPlan, fetchProxied: boolean): string {
  const https = plan.env.HTTPS_PROXY ?? plan.env.https_proxy;
  const http = plan.env.HTTP_PROXY ?? plan.env.http_proxy;
  const parts = [`network proxy source=${plan.source}`];
  if (https) parts.push(`https=${redactProxyUrl(https)}`);
  if (http && http !== https) parts.push(`http=${redactProxyUrl(http)}`);
  parts.push(`fetch=${fetchProxied ? 'proxied' : 'direct'}`);
  if (plan.invalidReason) parts.push(`invalidSetting=${JSON.stringify(plan.invalidReason)}`);
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
