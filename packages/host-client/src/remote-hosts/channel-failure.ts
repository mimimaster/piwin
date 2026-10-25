import { REMOTE_CHANNEL_CLOSE } from '@piwin/contracts';
import {
  HostHandshakeError,
  HostSocketClosedError,
  RELAY_SECURE_SOCKET_CLOSE,
} from '@piwin/host-transport';

/** Why a channel dial failed, in terms a shell can phrase for a person. */
export type ChannelFailureKind =
  /** 4404: Host offline, or not behind this relay (deliberately ambiguous). */
  | 'host-unavailable'
  /** The Host's key did not match the pinned one: pair again. */
  | 'host-key-mismatch'
  /** 4429: the relay's connection or rate limit. */
  | 'relay-limited'
  /** 4403: the relay refused this request. */
  | 'relay-forbidden';

/**
 * Maps a dial error to a failure kind. A Host-supplied hello reject reason is
 * the caller's to show; this only covers what the channel and relay report.
 */
export function classifyChannelFailure(error: unknown): ChannelFailureKind | undefined {
  if (error instanceof HostHandshakeError && error.reason !== undefined) return undefined;
  const code =
    error instanceof HostHandshakeError || error instanceof HostSocketClosedError
      ? error.closeCode
      : undefined;
  switch (code) {
    case REMOTE_CHANNEL_CLOSE.unavailable:
      return 'host-unavailable';
    case RELAY_SECURE_SOCKET_CLOSE.handshakeFailed:
      return 'host-key-mismatch';
    case REMOTE_CHANNEL_CLOSE.limited:
      return 'relay-limited';
    case REMOTE_CHANNEL_CLOSE.forbidden:
      return 'relay-forbidden';
    default:
      return undefined;
  }
}
