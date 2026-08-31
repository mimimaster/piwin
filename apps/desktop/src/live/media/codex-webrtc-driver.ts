import type {
  LiveClientBootstrapInput,
  LiveOwnerActionPush,
  LiveOwnerBootstrap,
  LiveOwnerEvent,
} from '@piwin/contracts';
import { LivePeer, type LivePeerSnapshot } from '../live-peer.js';
import type { DesktopLiveMediaDriver } from './live-media-driver.js';

export function createCodexWebrtcDriver(peer = new LivePeer()): DesktopLiveMediaDriver {
  const eventListeners = new Set<(event: LiveOwnerEvent) => void>();
  let offerResolve: ((sdp: string) => void) | null = null;
  let offerReject: ((error: unknown) => void) | null = null;
  let answerResolve: ((sdp: string) => void) | null = null;
  let answerReject: ((error: unknown) => void) | null = null;
  let startWork: Promise<void> | null = null;

  function emitEvent(event: LiveOwnerEvent): void {
    for (const listener of eventListeners) listener(event);
  }

  return {
    id: 'codex-webrtc-v1',
    isSupported() {
      return typeof RTCPeerConnection === 'function';
    },
    snapshot() {
      return peer.snapshot();
    },
    subscribe(listener: (snapshot: LivePeerSnapshot) => void) {
      return peer.subscribe(listener);
    },
    async prepareStart(): Promise<LiveClientBootstrapInput> {
      const offerSdp = await new Promise<string>((resolve, reject) => {
        offerResolve = resolve;
        offerReject = reject;
        startWork = peer
          .start({
            onOwnerEvent: emitEvent,
            negotiate: async (sdp, signal) => {
              offerResolve?.(sdp);
              const answerSdp = await new Promise<string>((answerOk, answerFail) => {
                answerResolve = answerOk;
                answerReject = answerFail;
                if (signal.aborted) {
                  answerFail(new DOMException('aborted', 'AbortError'));
                } else {
                  signal.addEventListener(
                    'abort',
                    () => answerFail(new DOMException('aborted', 'AbortError')),
                    { once: true },
                  );
                }
              });
              return { answerSdp };
            },
          })
          .then(
            () => undefined,
            (error: unknown) => {
              reject(error);
              throw error;
            },
          );
        // prepareStart awaits the offer, while connect awaits startWork later.
        // Observe failures immediately even when no connect call will follow.
        void startWork.catch(() => undefined);
      });
      return { mediaDriverId: 'codex-webrtc-v1', offerSdp };
    },
    async connect(bootstrap: LiveOwnerBootstrap): Promise<void> {
      if (bootstrap.mediaDriverId !== 'codex-webrtc-v1') {
        throw new Error('live-media-unsupported');
      }
      answerResolve?.(bootstrap.answerSdp);
      await startWork;
    },
    setMuted(muted: boolean) {
      peer.setMuted(muted);
    },
    async handleOwnerAction(action: LiveOwnerActionPush) {
      if (action.action === 'release-media') {
        await peer.stop();
        return;
      }
      if (action.action === 'ack-delegation' && action.providerDelegationId) {
        peer.sendDelegationAck({
          providerDelegationId: action.providerDelegationId,
          ok: action.ok === true,
          ...(action.runId ? { runId: action.runId } : {}),
          ...(action.messageId ? { messageId: action.messageId } : {}),
          ...(action.queueId ? { queueId: action.queueId } : {}),
        });
        return;
      }
      if (action.action === 'append-context' && action.content) {
        peer.sendContextAppend({
          target: action.target === 'delegation' ? 'delegation' : 'session',
          channel: action.channel === 'commentary' ? 'commentary' : 'speakable',
          content: action.content,
          ...(action.providerDelegationId
            ? { providerDelegationId: action.providerDelegationId }
            : {}),
        });
      }
    },
    subscribeEvents(listener) {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
    appendContext(input) {
      peer.sendContextAppend(input);
    },
    async close() {
      offerReject?.(new DOMException('aborted', 'AbortError'));
      offerReject = null;
      const rejectAnswer = answerReject;
      answerReject = null;
      rejectAnswer?.(new DOMException('aborted', 'AbortError'));
      // A browser microphone permission prompt is not abortable. Do not wait
      // for it here; LivePeer stops a late stream as soon as it is granted.
      await peer.stop();
    },
  };
}
