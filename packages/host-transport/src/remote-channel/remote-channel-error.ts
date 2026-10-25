export type RemoteChannelErrorReason =
  | 'handshake-failed'
  | 'host-key-mismatch'
  | 'decrypt-failed'
  | 'frame-invalid'
  | 'frame-too-large'
  | 'nonce-exhausted'
  | 'channel-closed';

/**
 * Any failure on the end-to-end channel (ADR 0101). A channel that raised one
 * is dead: callers close the transport instead of retrying the frame.
 */
export class RemoteChannelError extends Error {
  public readonly name = 'RemoteChannelError';
  public readonly reason: RemoteChannelErrorReason;

  public constructor(reason: RemoteChannelErrorReason, message: string) {
    super(message);
    this.reason = reason;
  }
}
