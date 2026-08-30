import type {
  LiveClientBootstrapInput,
  LiveMediaDriverId,
  LiveOwnerActionPush,
  LiveOwnerBootstrap,
  LiveOwnerEvent,
} from '@piwin/contracts';
import type { LivePeerSnapshot } from '../live-peer.js';

export type DesktopLiveMediaDriver = {
  id: LiveMediaDriverId;
  isSupported(): boolean;
  snapshot(): LivePeerSnapshot;
  subscribe(listener: (snapshot: LivePeerSnapshot) => void): () => void;
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
