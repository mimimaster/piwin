export type WindowPresenceSnapshot = { focused: boolean; documentVisible: boolean };

export function getWindowPresence(): WindowPresenceSnapshot {
  throw new Error('AN-X2 not implemented');
}

export function subscribeWindowPresence(
  listener: (snapshot: WindowPresenceSnapshot) => void,
): () => void {
  void listener;
  throw new Error('AN-X2 not implemented');
}
