/** Remote workbench is mid-reconnect; Host commands would hang or no-op. */
export function shouldBlockRemoteHostGesture(hostClient?: {
  getTransport?: () => string;
  isReady?: () => boolean;
} | null): boolean {
  return hostClient?.getTransport?.() === 'remote' && !hostClient?.isReady?.();
}

/** Banner tracks the socket, not reducer hostReady (that flag also means "Host process warming"). */
export function shouldShowHostReconnectBanner(input: {
  transport: string;
  wireReady: boolean;
}): boolean {
  return input.transport === 'remote' && !input.wireReady;
}
