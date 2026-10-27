/**
 * Why connecting to (or pairing with) a Host failed, in words a person can act
 * on. Transport errors arrive as `Host WebSocket closed before handshake
 * (1006): …`; showing that verbatim told nobody what to fix.
 */
import { formatError, type HostHelloRejectReason } from '@piwin/contracts';
import { classifyChannelFailure, type ChannelFailureKind } from '@piwin/host-client';
import { HostHandshakeError, HostSocketClosedError } from '@piwin/host-transport';

export type HostConnectFailure =
  /** The Host answered and refused, with a reason it named. */
  | { kind: 'rejected'; reason: HostHelloRejectReason }
  /** The relay or the encrypted channel refused (ADR 0101 close codes). */
  | { kind: 'channel'; failure: ChannelFailureKind }
  /** Nothing usable answered at that address. */
  | { kind: 'unreachable' }
  /** Already user-facing copy (e.g. a malformed address). */
  | { kind: 'message'; text: string }
  | { kind: 'other'; detail: string };

export type HostConnectFailureCopy = {
  rejectReasons: Record<HostHelloRejectReason, string>;
  channelFailures: Record<ChannelFailureKind, string>;
  unreachable: string;
  /** Appended for a `wss://` address: it may be the relay, which is not a Host. */
  unreachableRelayHint: string;
  connectFailed: (detail: string) => string;
};

const UNREACHABLE_MESSAGE =
  /closed before handshake|connect(?:ion)? timed? ?out|timed out|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|connection refused|failed to connect|network error|Host WebSocket error/i;

export function classifyHostConnectFailure(error: unknown): HostConnectFailure {
  if (error instanceof HostHandshakeError && error.reason !== undefined) {
    return { kind: 'rejected', reason: error.reason };
  }
  const channel = classifyChannelFailure(error);
  if (channel !== undefined) {
    return { kind: 'channel', failure: channel };
  }
  if (error instanceof HostSocketClosedError) {
    return { kind: 'unreachable' };
  }
  const detail = formatError(error);
  return UNREACHABLE_MESSAGE.test(detail) ? { kind: 'unreachable' } : { kind: 'other', detail };
}

export function describeHostConnectFailure(
  failure: HostConnectFailure,
  copy: HostConnectFailureCopy,
  endpoint?: string,
): string {
  switch (failure.kind) {
    case 'rejected':
      return copy.rejectReasons[failure.reason];
    case 'channel':
      return copy.channelFailures[failure.failure];
    case 'unreachable':
      return endpoint?.trim().startsWith('wss://') === true
        ? `${copy.unreachable}${copy.unreachableRelayHint}`
        : copy.unreachable;
    case 'message':
      return failure.text;
    case 'other':
      return copy.connectFailed(failure.detail);
  }
}

/** A bare `ws://` / `wss://` address pasted where a pairing link belongs. */
export function looksLikeBareSocketAddress(raw: string): boolean {
  return /^wss?:\/\/\S+$/i.test(raw.trim());
}
