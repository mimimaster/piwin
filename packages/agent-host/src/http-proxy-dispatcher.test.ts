import { createServer, type Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureEnvHttpProxyDispatcher } from './http-proxy-dispatcher.js';

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

describe('configureEnvHttpProxyDispatcher', () => {
  const proxied: string[] = [];
  const origin = createServer((_request, response) => {
    response.end('via-proxy');
  });
  // Forward every request, whatever host it names, to the local origin: the
  // target host does not resolve, so only a proxied fetch can succeed.
  const proxy = createServer((request, response) => {
    proxied.push(`${request.method ?? ''} ${request.url ?? ''}`);
    response.end('via-proxy');
  });
  proxy.on('connect', (request, clientSocket, head) => {
    proxied.push(`CONNECT ${request.url ?? ''}`);
    const upstream = connect((origin.address() as AddressInfo).port, '127.0.0.1', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
  });
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    await listen(origin);
    const proxyPort = await listen(proxy);
    for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy']) {
      delete process.env[key];
    }
    process.env.HTTP_PROXY = `http://127.0.0.1:${proxyPort}`;
  });

  afterAll(async () => {
    process.env = savedEnv;
    await Promise.all([close(proxy), close(origin)]);
  });

  it('routes global fetch through HTTP_PROXY', async () => {
    expect(configureEnvHttpProxyDispatcher()).toBe(true);
    const response = await fetch('http://piwin-proxy-test.invalid/ping');
    expect(await response.text()).toBe('via-proxy');
    expect(proxied.join('\n')).toContain('piwin-proxy-test.invalid');
  });

  it('goes direct again once the proxy variables are removed', async () => {
    delete process.env.HTTP_PROXY;
    expect(configureEnvHttpProxyDispatcher()).toBe(false);
    const before = proxied.length;
    const port = (origin.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/direct`);
    expect(await response.text()).toBe('via-proxy');
    expect(proxied.length).toBe(before);
    await expect(fetch('http://piwin-proxy-test.invalid/ping')).rejects.toThrow();
  });
});
