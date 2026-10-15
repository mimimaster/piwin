import { describe, expect, it } from 'vitest';
import {
  describeHostNetworkProxy,
  redactProxyUrl,
  resolveHostNetworkProxy,
} from './host-network-proxy.js';
import { parseScutilProxyOutput } from './macos-system-proxy.js';

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
  it('reads enabled HTTP/HTTPS proxies and the bypass list', () => {
    expect(parseScutilProxyOutput(CLASH_SYSTEM_PROXY)).toEqual({
      httpProxy: 'http://127.0.0.1:7897',
      httpsProxy: 'http://127.0.0.1:7897',
      exceptions: ['192.168.0.0/16', '.local', 'localhost'],
    });
  });

  it('ignores disabled proxies and SOCKS-only setups', () => {
    expect(parseScutilProxyOutput(NO_SYSTEM_PROXY)).toEqual({ exceptions: [] });
    const socksOnly = NO_SYSTEM_PROXY.replace(
      'SOCKSEnable : 0',
      'SOCKSEnable : 1\n  SOCKSPort : 1080\n  SOCKSProxy : 127.0.0.1',
    );
    expect(parseScutilProxyOutput(socksOnly)).toEqual({ exceptions: [] });
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

describe('resolveHostNetworkProxy', () => {
  it('keeps explicit proxy variables and skips the system lookup', () => {
    expect(
      resolveHostNetworkProxy({
        env: { https_proxy: 'http://proxy.corp:3128' },
        platform: 'darwin',
        readSystemProxy: failRead,
      }),
    ).toEqual({ source: 'env', assign: {} });
  });

  it('fills the GUI-launched sidecar env from the macOS system proxy', () => {
    expect(
      resolveHostNetworkProxy({
        env: {},
        platform: 'darwin',
        readSystemProxy: () => CLASH_SYSTEM_PROXY,
      }),
    ).toEqual({
      source: 'system',
      assign: {
        HTTP_PROXY: 'http://127.0.0.1:7897',
        HTTPS_PROXY: 'http://127.0.0.1:7897',
        NO_PROXY: 'localhost,127.0.0.1,::1,192.168.0.0/16,.local',
      },
    });
  });

  it('does not count NO_PROXY alone as a configured proxy', () => {
    expect(
      resolveHostNetworkProxy({
        env: { NO_PROXY: 'internal.corp' },
        platform: 'darwin',
        readSystemProxy: () => CLASH_SYSTEM_PROXY,
      }),
    ).toEqual({
      source: 'system',
      assign: { HTTP_PROXY: 'http://127.0.0.1:7897', HTTPS_PROXY: 'http://127.0.0.1:7897' },
    });
  });

  it('stays direct off macOS, when opted out, or with no system proxy', () => {
    expect(
      resolveHostNetworkProxy({ env: {}, platform: 'linux', readSystemProxy: failRead }),
    ).toEqual({ source: 'none', assign: {} });
    expect(
      resolveHostNetworkProxy({
        env: { PIWIN_SYSTEM_PROXY: '0' },
        platform: 'darwin',
        readSystemProxy: failRead,
      }),
    ).toEqual({ source: 'none', assign: {} });
    expect(
      resolveHostNetworkProxy({
        env: {},
        platform: 'darwin',
        readSystemProxy: () => NO_SYSTEM_PROXY,
      }),
    ).toEqual({ source: 'none', assign: {} });
  });

  it('reports a failed system lookup instead of hiding it', () => {
    const resolution = resolveHostNetworkProxy({
      env: {},
      platform: 'darwin',
      readSystemProxy: () => {
        throw new Error('scutil missing');
      },
    });
    expect(resolution.source).toBe('none');
    expect(resolution.systemError).toContain('scutil missing');
  });
});

describe('describeHostNetworkProxy', () => {
  it('logs the proxy without credentials', () => {
    expect(
      describeHostNetworkProxy({ source: 'env', assign: {} }, true, {
        HTTPS_PROXY: 'http://user:secret@proxy.corp:3128',
      }),
    ).toBe('network proxy source=env https=http://proxy.corp:3128 fetch=proxied');
    expect(redactProxyUrl('not a url')).toBe('<invalid proxy url>');
  });
});
