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
  /**
   * The shell has a reason to believe the link changed (app back in the
   * foreground, network came back). Probe an open link now, or skip the
   * pending backoff and redial. Returns false when there was nothing to wake
   * (closed for good, dial already in flight) so the shell can decide to
   * build a fresh connection. Optional: transports without a socket omit it.
   */
  wake?(): boolean;
  close(): Promise<void>;
};

export type HostClientHelloFactory = (lastSeq: number) => HostClientHello;
