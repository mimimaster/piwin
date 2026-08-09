import type {
  HostClientHello,
  HostCommandFrame,
  HostHello,
  HostReplayFrame,
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

export type HostTransport = {
  setHelloFactory(factory: HostClientHelloFactory): void;
  setLastSeq(lastSeq: number): void;
  connect(): Promise<HostHello>;
  send(message: HostCommandFrame | HostReplayFrame): void;
  subscribe(listener: HostTransportMessageListener): () => void;
  subscribeState(listener: HostTransportStateListener): () => void;
  close(): Promise<void>;
};

export type HostClientHelloFactory = (lastSeq: number) => HostClientHello;
