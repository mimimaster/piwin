import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { isRemoteId, parseRemoteChannelPath, REMOTE_CHANNEL_CLOSE } from '@piwin/contracts';
import { WebSocketServer, type WebSocket } from 'ws';
import type { RelayContext } from './relay-context.js';
import type { RelayEnrollToken } from './relay-enroll-token.js';
import { runRelayHostSession } from './relay-host-session.js';
import { DEFAULT_RELAY_LIMITS, RelayRateLimiter, type RelayLimits } from './relay-limits.js';
import type { RelayLogger } from './relay-log.js';
import { runRelayPeerSession } from './relay-peer-session.js';
import { RelayRooms } from './relay-rooms.js';
import { serveRelayStatic } from './relay-static.js';
import type { RelayUserRegistry } from './relay-user-registry.js';

export type RelayServerOptions = {
  registry: RelayUserRegistry;
  persistRegistry: () => Promise<void>;
  enrollToken?: RelayEnrollToken;
  limits?: Partial<RelayLimits>;
  /** Directory of the browser shell bundle; absent means `/` is 404. */
  webRoot?: string;
  /** Read the client IP from `X-Forwarded-For` (only behind a reverse proxy you run). */
  trustProxy?: boolean;
  log: RelayLogger;
};

export type RelayServer = {
  listen(port: number, host: string): Promise<{ port: number; url: string }>;
  /** Re-checks attached Hosts after the registry changed (disable, remove, deny). */
  reconcileRegistry(): void;
  close(): Promise<void>;
};

/**
 * The content-blind relay (ADR 0101 §7). It authenticates Hosts, assigns peer
 * ids and forwards opaque frames; it never sees a key or a plaintext byte.
 */
export function createRelayServer(options: RelayServerOptions): RelayServer {
  const limits: RelayLimits = { ...DEFAULT_RELAY_LIMITS, ...options.limits };
  const context: RelayContext = {
    registry: options.registry,
    rooms: new RelayRooms<WebSocket>(),
    limits,
    enrollToken: options.enrollToken,
    persistRegistry: options.persistRegistry,
    log: options.log,
  };
  const rateLimiter = new RelayRateLimiter(limits.connectionsPerIpPerWindow, limits.rateWindowMs);
  // ws enforces a hard cap; the sessions enforce the protocol limit with 4413.
  const wsServer = new WebSocketServer({ noServer: true, maxPayload: limits.maxFrameBytes * 2 });
  const alive = new WeakSet<WebSocket>();

  const httpServer: Server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://relay').pathname;
    if (pathname === '/healthz') {
      response.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
      return;
    }
    if (options.webRoot === undefined) {
      response.writeHead(404).end();
      return;
    }
    void serveRelayStatic(options.webRoot, request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });

  httpServer.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const ip = clientIp(request, options.trustProxy === true);
    if (!rateLimiter.tryAcquire(ip)) {
      context.log({ kind: 'rate-limited', ip });
      rejectUpgrade(socket, 429, 'Too Many Requests');
      return;
    }
    const url = new URL(request.url ?? '/', 'http://relay');
    const path = parseRemoteChannelPath(url.pathname);
    const hostId = url.searchParams.get('hostId');
    if (path === undefined || !isRemoteId(hostId)) {
      rejectUpgrade(socket, 400, 'Bad Request');
      return;
    }
    wsServer.handleUpgrade(request, socket, head, (webSocket) => {
      alive.add(webSocket);
      webSocket.on('pong', () => alive.add(webSocket));
      webSocket.on('error', () => webSocket.terminate());
      const route = { userId: path.userId, hostId };
      if (path.route === 'host') runRelayHostSession(context, webSocket, route);
      else runRelayPeerSession(context, webSocket, route);
    });
  });

  const pingTimer = setInterval(() => {
    for (const client of wsServer.clients) {
      if (!alive.has(client)) {
        client.terminate();
        continue;
      }
      alive.delete(client);
      client.ping();
    }
  }, limits.pingIntervalMs);
  pingTimer.unref();

  return {
    listen: (port, host) =>
      new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          httpServer.off('error', reject);
          const address = httpServer.address() as AddressInfo;
          const url = `ws://${host.includes(':') ? `[${host}]` : host}:${address.port}`;
          context.log({ kind: 'listening', url });
          resolve({ port: address.port, url });
        });
      }),
    reconcileRegistry: () => {
      for (const { userId, hostId, host } of context.rooms.listHosts()) {
        const user = context.registry.find(userId);
        if (user === undefined || user.disabled || context.registry.isHostDenied(hostId)) {
          host.close(REMOTE_CHANNEL_CLOSE.forbidden, 'access revoked');
        }
      }
    },
    close: async () => {
      clearInterval(pingTimer);
      for (const client of wsServer.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve) => wsServer.close(() => resolve()));
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        httpServer.closeAllConnections();
      });
    },
  };
}

function clientIp(request: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    if (first !== undefined && first.length > 0) {
      return first;
    }
  }
  return request.socket.remoteAddress ?? 'unknown';
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
