import type {
  LiveClientBootstrapInput,
  LiveMediaDriverId,
  LiveOwnerActionPush,
  LiveOwnerBootstrap,
  LiveOwnerEvent,
} from '@piwin/contracts';

export type MobileLivePeerPhase =
  'idle' | 'acquiring-mic' | 'negotiating' | 'connected' | 'ended' | 'error';

export type MobileLivePeerErrorCode =
  | 'mic-denied'
  | 'mic-unavailable'
  | 'negotiate-failed'
  | 'peer-failed'
  | 'live-provider-auth'
  | 'live-provider-rejected'
  | 'live-protocol-failed';

export type MobileLivePeerSnapshot = {
  phase: MobileLivePeerPhase;
  muted: boolean;
  errorCode: MobileLivePeerErrorCode | null;
};

export type MobileLiveMediaDriver = {
  id: LiveMediaDriverId;
  isSupported(): boolean;
  snapshot(): MobileLivePeerSnapshot;
  subscribe(listener: (snapshot: MobileLivePeerSnapshot) => void): () => void;
  prepareStart(): Promise<LiveClientBootstrapInput>;
  connect(bootstrap: LiveOwnerBootstrap, signal: AbortSignal): Promise<void>;
  setMuted(muted: boolean): void;
  handleOwnerAction(action: LiveOwnerActionPush): Promise<void>;
  subscribeEvents(listener: (event: LiveOwnerEvent) => void): () => void;
  appendContext(input: {
    target: 'session' | 'delegation';
    channel: 'speakable' | 'commentary';
    content: string;
    providerDelegationId?: string;
  }): void;
  close(): Promise<void>;
};

export type MobileLiveSocket = {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: ((event?: { code?: number; reason?: string }) => void) | null;
};
