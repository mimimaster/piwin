import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { isRemoteChannelPathname } from '@piwin/contracts';
import { HOST_WIRE_HARD_FRAME_BYTES } from '@piwin/host-transport';
import { enrichHostListenError } from './listen-busy.js';
import { toError } from './host-server-support.js';

export type HostListener = {
  httpServer: HttpServer;
  wsServer: WebSocketServer;
};

export type HostChannelUpgradeHandler = (
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
) => void;

export type HostListenerOptions = {
  host: string;
  port: number;
  onRequest: (request: IncomingMessage, response: ServerResponse) => void;
  /** Upgrades on the legacy Host route (every path outside `/v1/u/`). */
  onConnection: (socket: WebSocket, request: IncomingMessage) => void;
  /**
   * Upgrades under `/v1/u/` (ADR 0101 channel routes). Absent means the
   * channel is not served on this listener and those upgrades get 404.
   */
  onChannelUpgrade?: HostChannelUpgradeHandler;
  /** Errors after the listener is up; startup errors reject `listening`. */
  onError: (error: Error) => void;
};

/**
 * One HTTP server carries plain requests (Web shell, device health ingress)
 * and WebSocket upgrades on a single port. Upgrades are routed by path so the
 * legacy Host route and the end-to-end channel can share the port during the
 * ADR 0101 migration window. `listener` is returned before `listening`
 * settles so a failed start can still be torn down.
 */
export function startHostListener(options: HostListenerOptions): {
  listener: HostListener;
  listening: Promise<{ port: number }>;
} {
  const httpServer = createHttpServer();
  const wsServer = new WebSocketServer({ noServer: true, maxPayload: HOST_WIRE_HARD_FRAME_BYTES });
  httpServer.on('request', options.onRequest);
  httpServer.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (isRemoteChannelPathname(upgradePathname(request.url))) {
      if (options.onChannelUpgrade === undefined) {
        rejectUpgrade(socket, 404, 'Not Found');
        return;
      }
      options.onChannelUpgrade(request, socket, head);
      return;
    }
    wsServer.handleUpgrade(request, socket, head, (ws) => {
      wsServer.emit('connection', ws, request);
    });
  });
  wsServer.on('connection', options.onConnection);

  let up = false;
  const listening = new Promise<{ port: number }>((resolve, reject) => {
    httpServer.on('error', (error) => {
      const normalized = toError(error, 'Host WebSocket server error');
      if (!up) {
        reject(enrichHostListenError(normalized, options.host, options.port));
        return;
      }
      options.onError(normalized);
    });
    httpServer.once('listening', () => {
      up = true;
      const address = httpServer.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Host WebSocket server did not expose a TCP address'));
        return;
      }
      resolve({ port: (address as AddressInfo).port });
    });
  });
  httpServer.listen(options.port, options.host);
  return { listener: { httpServer, wsServer }, listening };
}

/**
 * Closes the socket server (forcing stragglers after 2 s) and then the HTTP
 * server, which `ws` never owns in `noServer` mode.
 */
export async function stopHostListener(listener: HostListener): Promise<void> {
  const { wsServer, httpServer } = listener;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      for (const client of wsServer.clients) {
        try {
          client.terminate();
        } catch {
          // Ignore terminate races during forced shutdown.
        }
      }
      wsServer.close(() => resolve());
    }, 2_000);
    wsServer.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });
  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
    httpServer.closeAllConnections();
  });
}

function upgradePathname(url: string | undefined): string {
  if (url === undefined) {
    return '/';
  }
  const queryAt = url.indexOf('?');
  return queryAt === -1 ? url : url.slice(0, queryAt);
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
