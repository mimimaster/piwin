import { parseArtifactActionMessage, parseArtifactBridgeMessage } from '@piwin/artifact';

type ArtifactNativeHandler = (payload: unknown) => void;

const handlersByChannel = new Map<string, Set<ArtifactNativeHandler>>();
const pendingSizesByChannel = new Map<string, unknown>();
const MAX_PENDING_PAYLOADS = 32;

function dispatchNativePayload(payload: unknown): void {
  const sizeMessage = parseArtifactBridgeMessage(payload);
  const message = sizeMessage ?? parseArtifactActionMessage(payload);
  if (!message) return;

  const handlers = handlersByChannel.get(message.channelId);
  if (!handlers || handlers.size === 0) {
    if (sizeMessage) {
      if (
        !pendingSizesByChannel.has(message.channelId) &&
        pendingSizesByChannel.size >= MAX_PENDING_PAYLOADS
      ) {
        const oldestChannel = pendingSizesByChannel.keys().next().value;
        if (typeof oldestChannel === 'string') {
          pendingSizesByChannel.delete(oldestChannel);
        }
      }
      pendingSizesByChannel.delete(message.channelId);
      pendingSizesByChannel.set(message.channelId, payload);
    }
    return;
  }
  for (const handler of handlers) {
    handler(payload);
  }
}

async function attachNativeListener(): Promise<void> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return;
  }
  const { listen } = await import('@tauri-apps/api/event');
  await listen<unknown>('piwin-artifact-bridge', (event) => {
    dispatchNativePayload(event.payload);
  });
}

// Begin attaching while the application bundle is evaluated, before React can
// mount an Artifact iframe that emits its one completed-height report.
const nativeListenerReady = attachNativeListener();

/** Subscribe to WKWebView's frame-scoped Artifact return channel when packaged. */
export async function subscribeNativeArtifactBridge(
  channelId: string,
  handler: ArtifactNativeHandler,
): Promise<() => void> {
  const channelHandlers = handlersByChannel.get(channelId) ?? new Set<ArtifactNativeHandler>();
  channelHandlers.add(handler);
  handlersByChannel.set(channelId, channelHandlers);
  await nativeListenerReady;
  const pendingSize = pendingSizesByChannel.get(channelId);
  if (pendingSize !== undefined) {
    pendingSizesByChannel.delete(channelId);
    handler(pendingSize);
  }
  return () => {
    const currentHandlers = handlersByChannel.get(channelId);
    if (!currentHandlers) return;
    currentHandlers.delete(handler);
    if (currentHandlers.size === 0) {
      handlersByChannel.delete(channelId);
    }
  };
}
