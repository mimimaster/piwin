import { describe, expect, it } from 'vitest';
import {
  describeHostNetworkProxy,
  planHostProxyEnv,
  redactProxyUrl,
} from './host-network-proxy.js';
import { detectSystemProxy, parseScutilProxyOutput } from './macos-system-proxy.js';

const CLASH_SYSTEM_PROXY = `<dictionary> {
  ExcludeSimpleHostnames : 0
  ExceptionsList : <array> {
    0 : 192.168.0.0/16
    1 : *.local
    2 : localhost
  }
  FTPPassive : 1
  HTTPEnable : 1
  HTTPPort : 7897
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7897
  HTTPSProxy : 127.0.0.1
  ProxyAutoConfigEnable : 0
  SOCKSEnable : 1
  SOCKSPort : 7897
  SOCKSProxy : 127.0.0.1
}
`;

const NO_SYSTEM_PROXY = `<dictionary> {
  ExcludeSimpleHostnames : 0
  FTPPassive : 1
  HTTPEnable : 0
  HTTPSEnable : 0
  ProxyAutoConfigEnable : 0
  SOCKSEnable : 0
}
`;

function failRead(): string {
  throw new Error('system proxy must not be read');
}

describe('parseScutilProxyOutput', () => {
  it('reads enabled HTTP/HTTPS proxies', () => {
    expect(parseScutilProxyOutput(CLASH_SYSTEM_PROXY)).toEqual({
      httpProxy: 'http://127.0.0.1:7897',
      httpsProxy: 'http://127.0.0.1:7897',
    });
  });

  it('ignores disabled proxies and SOCKS-only setups', () => {
    expect(parseScutilProxyOutput(NO_SYSTEM_PROXY)).toEqual({});
    const socksOnly = NO_SYSTEM_PROXY.replace(
      'SOCKSEnable : 0',
      'SOCKSEnable : 1\n  SOCKSPort : 1080\n  SOCKSProxy : 127.0.0.1',
    );
    expect(parseScutilProxyOutput(socksOnly)).toEqual({});
  });

  it('brackets IPv6 proxy hosts and rejects bad ports', () => {
    const ipv6 = NO_SYSTEM_PROXY.replace(
      'HTTPSEnable : 0',
      'HTTPSEnable : 1\n  HTTPSPort : 8080\n  HTTPSProxy : ::1',
    );
    expect(parseScutilProxyOutput(ipv6).httpsProxy).toBe('http://[::1]:8080');
    const badPort = NO_SYSTEM_PROXY.replace(
      'HTTPEnable : 0',
      'HTTPEnable : 1\n  HTTPPort : 0\n  HTTPProxy : 127.0.0.1',
    );
    expect(parseScutilProxyOutput(badPort).httpProxy).toBeUndefined();
  });
});

describe('detectSystemProxy', () => {
  it('offers the macOS HTTPS proxy, falling back to HTTP', () => {
    expect(detectSystemProxy('darwin', () => CLASH_SYSTEM_PROXY)).toEqual({
      supported: true,
      proxyUrl: 'http://127.0.0.1:7897',
    });
    const httpOnly = NO_SYSTEM_PROXY.replace(
      'HTTPEnable : 0',
      'HTTPEnable : 1\n  HTTPPort : 8080\n  HTTPProxy : proxy.corp',
    );
    expect(detectSystemProxy('darwin', () => httpOnly).proxyUrl).toBe('http://proxy.corp:8080');
  });

  it('reports no proxy, unsupported platforms, and read failures', () => {
    expect(detectSystemProxy('darwin', () => NO_SYSTEM_PROXY)).toEqual({ supported: true });
    expect(detectSystemProxy('linux', failRead)).toEqual({ supported: false });
    const failed = detectSystemProxy('darwin', () => {
      throw new Error('scutil missing');
    });
    expect(failed.supported).toBe(true);
    expect(failed.error).toContain('scutil missing');
  });
});

describe('planHostProxyEnv', () => {
  it('inherits the launch environment when no proxy is configured', () => {
    expect(planHostProxyEnv(undefined, { https_proxy: 'http://proxy.corp:3128', PATH: '/bin' })).toEqual({
      source: 'env',
      env: { https_proxy: 'http://proxy.corp:3128' },
    });
    expect(planHostProxyEnv({}, {})).toEqual({ source: 'none', env: {} });
    expect(planHostProxyEnv(undefined, { NO_PROXY: 'internal.corp' })).toEqual({
      source: 'none',
      env: { NO_PROXY: 'internal.corp' },
    });
  });

  it('overrides the launch environment with an explicit proxy URL', () => {
    const url = 'http://127.0.0.1:7897';
    expect(
      planHostProxyEnv({ proxyUrl: url }, { HTTPS_PROXY: 'http://other:1', no_proxy: 'internal.corp' }),
    ).toEqual({
      source: 'setting',
      env: {
        HTTP_PROXY: url,
        HTTPS_PROXY: url,
        NO_PROXY: 'internal.corp',
        http_proxy: url,
        https_proxy: url,
        no_proxy: 'internal.corp',
      },
    });
    expect(planHostProxyEnv({ proxyUrl: url }, {}).env.NO_PROXY).toBe('localhost,127.0.0.1,::1');
  });

  it('drops every proxy variable for direct', () => {
    expect(planHostProxyEnv({ proxyUrl: 'direct' }, { HTTPS_PROXY: 'http://proxy.corp:3128' })).toEqual({
      source: 'direct',
      env: {},
    });
    expect(planHostProxyEnv({ proxyUrl: 'NONE' }, {}).source).toBe('direct');
  });

  it('keeps the launch environment and reports an unusable stored value', () => {
    const plan = planHostProxyEnv({ proxyUrl: 'socks5://127.0.0.1:1080' }, {});
    expect(plan.source).toBe('none');
    expect(plan.invalidReason).toContain('SOCKS');
  });
});

describe('describeHostNetworkProxy', () => {
  it('logs the proxy without credentials', () => {
    expect(
      describeHostNetworkProxy(
        { source: 'env', env: { HTTPS_PROXY: 'http://user:secret@proxy.corp:3128' } },
        true,
      ),
    ).toBe('network proxy source=env https=http://proxy.corp:3128 fetch=proxied');
    expect(redactProxyUrl('not a url')).toBe('<invalid proxy url>');
  });
});
