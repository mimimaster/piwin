/** Send is not an upstream receipt, but a closed channel must never look sent. */
export function sendLiveFrames(
  channel: { readyState: string; send: (payload: string) => void } | null,
  payloads: readonly string[],
): void {
  if (!payloads.length) return;
  if (!channel || channel.readyState !== 'open') throw new Error('live-protocol-failed');
  try {
    for (const payload of payloads) channel.send(payload);
  } catch {
    throw new Error('live-protocol-failed');
  }
}
