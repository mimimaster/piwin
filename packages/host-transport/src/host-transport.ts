import type {
  HostClientHello,
  HostClientOutboundFrame,
  HostHello,
  HostWireMessage,
} from '@piwin/contracts';

export type HostTransportState =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'open' }
  | { kind: 'closed'; reason?: string }
  | { kind: 'error'; reason: string };

export type HostTransportMessageListener = (message: HostWireMessage) => void;

export type HostTransportStateListener = (state: HostTransportState) => void;

/** Out-of-band binary frame listener (spec §4.1.2). Bytes are not retained. */
export type HostTransportBinaryListener = (bytes: Uint8Array) => void;

export type HostTransport = {
  setHelloFactory(factory: HostClientHelloFactory): void;
  setLastSeq(lastSeq: number): void;
  connect(): Promise<HostHello>;
  send(message: HostClientOutboundFrame): void;
  subscribe(listener: HostTransportMessageListener): () => void;
  subscribeState(listener: HostTransportStateListener): () => void;
  /**
   * Binary messages from the Host (browser JPEG frames). Optional: transports
   * without a binary channel simply never call the listener.
   */
  subscribeBinary?(listener: HostTransportBinaryListener): () => void;
  close(): Promise<void>;
};

export type HostClientHelloFactory = (lastSeq: number) => HostClientHello;
