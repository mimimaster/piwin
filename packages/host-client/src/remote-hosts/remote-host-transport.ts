import type { HostBookEntry, HostClientHello, HostEndpointsData } from '@piwin/contracts';
import {
  decodeBase64Url,
  RelaySecureSocket,
  WebSocketHostTransport,
  type NoiseKeyPair,
  type RelayInnerSocketFactory,
  type WebSocketHostTransportOptions,
} from '@piwin/host-transport';
import { HostDialPlan, type DialPath } from './host-dial-plan.js';

export type RemoteHostTransportOptions = {
  entry: HostBookEntry;
  clientKeyPair: NoiseKeyPair;
  /** The platform socket: browser WebSocket, Tauri native bridge, Node `ws`. */
  createInnerSocket: RelayInnerSocketFactory;
  createHello: (lastSeq: number) => HostClientHello;
  /** `host/hello` and `host/endpoints` addresses, for the shell's host book. */
  onEndpoints?: (endpoints: HostEndpointsData) => void;
  /** The path the current connection uses, for "中转 / 直连" in the UI. */
  onPath?: (path: DialPath | undefined) => void;
  transportOptions?: Omit<
    WebSocketHostTransportOptions,
    'endpoint' | 'createHello' | 'webSocketFactory'
  >;
};

export type RemoteHostTransport = {
  transport: WebSocketHostTransport;
  plan: HostDialPlan;
  /** Foreground / network change: start from the relay again and redial. */
  wake: () => boolean;
};

/**
 * One paired Host as a `HostTransport` (ADR 0101 §8): every dial picks a path
 * from the plan (relay first, direct fallback) and runs the Noise channel
 * pinned to the entry's Host key. Hello, heartbeat, backoff and replay are
 * `WebSocketHostTransport`'s, unchanged.
 */
export function createRemoteHostTransport(
  options: RemoteHostTransportOptions,
): RemoteHostTransport {
  const plan = new HostDialPlan(options.entry);
  let target = options.entry;
  const hostKey = decodeBase64Url(options.entry.hostKey);
  if (hostKey?.length !== 32) {
    throw new Error('Host book entry has no valid Host key');
  }
  const transport = new WebSocketHostTransport({
    ...options.transportOptions,
    endpoint: plan.next().url,
    createHello: options.createHello,
    webSocketFactory: () => {
      const choice = plan.next();
      return new RelaySecureSocket({
        url: choice.url,
        userId: target.userId,
        hostId: target.hostId,
        hostKey,
        clientStaticKeyPair: options.clientKeyPair,
        createInnerSocket: options.createInnerSocket,
        observer: {
          onOpen: () => options.onPath?.(choice.path),
          onClose: (event, opened) => {
            plan.reportClosed(event.code, opened);
            options.onPath?.(undefined);
          },
        },
      });
    },
  });
  transport.subscribe((message) => {
    const endpoints =
      message.type === 'host/endpoints'
        ? message.endpoints
        : message.type === 'host/hello'
          ? message.endpoints
          : undefined;
    if (endpoints === undefined || endpoints.hostId !== target.hostId) {
      return;
    }
    const { relayUrl: _relay, directUrl: _direct, ...rest } = target;
    target = {
      ...rest,
      userId: endpoints.userId,
      userName: endpoints.userName,
      hostName: endpoints.hostName,
      ...(endpoints.relayUrl === undefined ? {} : { relayUrl: endpoints.relayUrl }),
      ...(endpoints.directUrl === undefined ? {} : { directUrl: endpoints.directUrl }),
    };
    if (target.relayUrl !== undefined || target.directUrl !== undefined) {
      plan.update(target);
    }
    options.onEndpoints?.(endpoints);
  });
  return {
    transport,
    plan,
    wake: () => {
      plan.reset();
      return transport.wake();
    },
  };
}
