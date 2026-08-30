import { useEffect, useRef, useState } from 'react';
import {
  LiveSpikePeer,
  negotiateViaSpikeServer,
  type LiveSpikeSnapshot,
} from './live-spike-peer.js';

const DEFAULT_SPIKE_SERVER = 'http://127.0.0.1:8787';

export function useLiveSpikePeer(options?: { spikeServerUrl?: string }) {
  const peerRef = useRef<LiveSpikePeer | null>(null);
  const [snapshot, setSnapshot] = useState<LiveSpikeSnapshot>({
    phase: 'idle',
    muted: false,
    errorCode: null,
    remotePlaying: false,
    cleanupCount: 0,
  });

  useEffect(() => {
    const peer = new LiveSpikePeer();
    peerRef.current = peer;
    const unsubscribe = peer.subscribe(setSnapshot);
    return () => {
      unsubscribe();
      peer.dispose();
      peerRef.current = null;
    };
  }, []);

  const spikeServerUrl = options?.spikeServerUrl ?? DEFAULT_SPIKE_SERVER;

  return {
    snapshot,
    startLoopback: async () => {
      await peerRef.current?.start({ mode: 'loopback' });
    },
    startRemote: async () => {
      await peerRef.current?.start({
        mode: 'remote',
        negotiate: (offer, signal) => negotiateViaSpikeServer(spikeServerUrl, offer, signal),
      });
    },
    setMuted: (muted: boolean) => {
      peerRef.current?.setMuted(muted);
    },
    bargeIn: () => {
      peerRef.current?.bargeIn();
    },
    resumeRemote: () => {
      peerRef.current?.resumeRemote();
    },
    stop: async () => {
      await peerRef.current?.stop();
    },
  };
}
