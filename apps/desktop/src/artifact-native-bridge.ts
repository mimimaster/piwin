type ArtifactNativeHandler = (payload: unknown) => void;

const handlers = new Set<ArtifactNativeHandler>();
const pendingPayloads: unknown[] = [];
const MAX_PENDING_PAYLOADS = 32;

function dispatchNativePayload(payload: unknown): void {
  if (handlers.size === 0) {
    pendingPayloads.push(payload);
    if (pendingPayloads.length > MAX_PENDING_PAYLOADS) {
      pendingPayloads.shift();
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
  handler: ArtifactNativeHandler,
): Promise<() => void> {
  handlers.add(handler);
  await nativeListenerReady;
  while (pendingPayloads.length > 0) {
    handler(pendingPayloads.shift());
  }
  return () => {
    handlers.delete(handler);
  };
}
