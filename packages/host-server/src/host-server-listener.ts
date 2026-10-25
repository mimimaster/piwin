import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { HOST_WIRE_HARD_FRAME_BYTES } from '@piwin/host-transport';
import { enrichHostListenError } from './listen-busy.js';
import { toError } from './host-server-support.js';

export type HostListener = {
  httpServer: HttpServer;
  wsServer: WebSocketServer;
};

export type HostListenerOptions = {
  host: string;
  port: number;
  onRequest: (request: IncomingMessage, response: ServerResponse) => void;
  onConnection: (socket: WebSocket, request: IncomingMessage) => void;
  /** Errors after the listener is up; startup errors reject `listening`. */
  onError: (error: Error) => void;
};

/**
 * One HTTP server carries plain requests (Web shell, device health ingress)
 * and the WebSocket upgrade on a single port. `listener` is returned before
 * `listening` settles so a failed start can still be torn down.
 */
export function startHostListener(options: HostListenerOptions): {
  listener: HostListener;
  listening: Promise<{ port: number }>;
} {
  const httpServer = createHttpServer();
  const wsServer = new WebSocketServer({
    server: httpServer,
    maxPayload: HOST_WIRE_HARD_FRAME_BYTES,
  });
  httpServer.on('request', options.onRequest);
  httpServer.listen(options.port, options.host);
  wsServer.on('connection', options.onConnection);

  let up = false;
  const listening = new Promise<{ port: number }>((resolve, reject) => {
    wsServer.on('error', (error) => {
      const normalized = toError(error, 'Host WebSocket server error');
      if (!up) {
        reject(enrichHostListenError(normalized, options.host, options.port));
        return;
      }
      options.onError(normalized);
    });
    wsServer.once('listening', () => {
      up = true;
      const address = wsServer.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Host WebSocket server did not expose a TCP address'));
        return;
      }
      resolve({ port: (address as AddressInfo).port });
    });
  });
  return { listener: { httpServer, wsServer }, listening };
}

/**
 * Closes the socket server (forcing stragglers after 2 s) and then the HTTP
 * server, which `ws` leaves open when it was handed one.
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
